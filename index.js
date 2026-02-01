/**
 * Language Assessment App - Firebase Cloud Functions
 * Secure Gemini AI Integration
 * 
 * SECURITY: API key stored in Firebase Secrets, never exposed to client
 * USAGE: firebase functions:secrets:set GEMINI_API_KEY
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');

admin.initializeApp();

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
    maxInputLength: 3000,        // Characters
    maxRequestsPerHour: 60,      // Per IP
    allowedTypes: ['writing', 'speaking', 'recommendations'],
    allowedLevels: ['A0', 'B1/B2', 'IELTS'],
    model: 'gemini-1.5-flash',
    generationConfig: {
        temperature: 0.3,        // Lower = more deterministic
        maxOutputTokens: 1000,
        topP: 0.8
    }
};

// =============================================================================
// RATE LIMITING (In-memory for Cloud Functions cold starts)
// =============================================================================

const rateLimitMap = new Map();

function checkRateLimit(ip) {
    const now = Date.now();
    const hourAgo = now - 3600000;
    
    if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, []);
    }
    
    // Clean old entries
    const requests = rateLimitMap.get(ip).filter(time => time > hourAgo);
    
    if (requests.length >= CONFIG.maxRequestsPerHour) {
        return { allowed: false, remaining: 0 };
    }
    
    requests.push(now);
    rateLimitMap.set(ip, requests);
    return { allowed: true, remaining: CONFIG.maxRequestsPerHour - requests.length };
}

// =============================================================================
// INPUT SANITIZATION & VALIDATION
// =============================================================================

function sanitizeInput(text) {
    if (typeof text !== 'string') return '';
    
    // Remove potential prompt injection patterns
    return text
        .replace(/ignore\s*(all\s*)?(previous|above|prior)\s*(instructions|prompts|context)/gi, '[FILTERED]')
        .replace(/disregard\s*(all\s*)?(previous|above|prior)/gi, '[FILTERED]')
        .replace(/system\s*:/gi, '[FILTERED]')
        .replace(/assistant\s*:/gi, '[FILTERED]')
        .replace(/human\s*:/gi, '[FILTERED]')
        .replace(/\[INST\]/gi, '[FILTERED]')
        .replace(/<\|.*?\|>/g, '[FILTERED]')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .substring(0, CONFIG.maxInputLength);
}

function validateRequest(data) {
    const errors = [];
    
    if (!data.type || !CONFIG.allowedTypes.includes(data.type)) {
        errors.push(`Invalid type. Allowed: ${CONFIG.allowedTypes.join(', ')}`);
    }
    
    if (!data.level || !CONFIG.allowedLevels.includes(data.level)) {
        errors.push(`Invalid level. Allowed: ${CONFIG.allowedLevels.join(', ')}`);
    }
    
    if (!data.content || typeof data.content !== 'string' || data.content.trim().length === 0) {
        errors.push('Content is required');
    }
    
    if (data.content && data.content.length > CONFIG.maxInputLength) {
        errors.push(`Content exceeds ${CONFIG.maxInputLength} characters`);
    }
    
    return errors;
}

// =============================================================================
// PROMPT TEMPLATES
// =============================================================================

const PROMPTS = {
    writing: (level, task, response) => `You are an English language assessment assistant helping teachers evaluate student writing. Provide constructive feedback aligned to CEFR standards.

STUDENT LEVEL: ${level}
WRITING TASK: ${task || 'General writing task'}

STUDENT'S RESPONSE:
---
${response}
---

Analyze this writing and respond with ONLY valid JSON (no markdown, no code blocks):

{
    "overallImpression": "2-3 sentences summarizing the writing quality",
    "strengths": ["strength 1", "strength 2", "strength 3"],
    "areasToImprove": ["area 1", "area 2", "area 3"],
    "grammarNotes": ["specific grammar observation 1", "observation 2"],
    "vocabularyNotes": ["vocabulary observation 1", "observation 2"],
    "coherenceNotes": "comment on organization and flow",
    "suggestedScore": {
        "range": "X-Y out of 10",
        "reasoning": "brief justification for this range"
    },
    "teacherTip": "one specific actionable suggestion for the teacher to discuss with student"
}

RULES:
- Be encouraging and constructive
- Align expectations to ${level} CEFR level
- Limit to 3 items per list
- This is TEACHER ASSISTANCE only, not final scoring
- Output ONLY the JSON object, nothing else`,

    speaking: (level, questions, notes) => `You are an English speaking assessment assistant helping teachers evaluate student speaking performance. Provide CEFR-aligned feedback.

STUDENT LEVEL: ${level}
SPEAKING QUESTIONS/TOPICS: ${questions || 'General speaking assessment'}

TEACHER'S OBSERVATION NOTES:
---
${notes}
---

Based on these notes, provide structured feedback as ONLY valid JSON (no markdown, no code blocks):

{
    "fluencyAssessment": "2 sentences about speech flow, pace, and hesitation patterns",
    "pronunciationNotes": "observations on pronunciation, stress, and intonation",
    "grammarInSpeech": "grammar patterns observed in spoken responses",
    "vocabularyRange": "assessment of vocabulary use and appropriateness",
    "interactionSkills": "ability to engage, respond to questions, maintain conversation",
    "suggestedCEFR": {
        "level": "A1 or A2 or B1 or B2 or C1",
        "confidence": "high or medium or low",
        "reasoning": "why this level seems appropriate"
    },
    "followUpSuggestions": ["suggested follow-up question 1", "question 2"],
    "teacherTip": "one actionable suggestion for helping this student improve"
}

RULES:
- Base assessment on teacher's notes, not assumptions
- Align to ${level} expected performance
- Be specific but concise
- This is TEACHER ASSISTANCE only
- Output ONLY the JSON object, nothing else`,

    recommendations: (level, scores, weakAreas) => `You are a language learning advisor. Based on assessment results, create a personalized study plan.

STUDENT LEVEL: ${level}
ASSESSMENT SCORES: ${JSON.stringify(scores)}
IDENTIFIED WEAK AREAS: ${weakAreas}

Create actionable recommendations as ONLY valid JSON (no markdown, no code blocks):

{
    "priorityFocus": "the single most important area to focus on first",
    "weeklyPlan": {
        "week1": "specific focus and activities for week 1",
        "week2": "specific focus and activities for week 2"
    },
    "specificExercises": [
        {"skill": "listening/reading/writing/speaking/grammar", "activity": "specific exercise description", "frequency": "how often"},
        {"skill": "...", "activity": "...", "frequency": "..."},
        {"skill": "...", "activity": "...", "frequency": "..."}
    ],
    "freeResources": [
        {"name": "resource name", "type": "website/app/youtube/book", "url": "if applicable", "why": "why this helps"},
        {"name": "...", "type": "...", "url": "...", "why": "..."}
    ],
    "milestones": [
        {"timeframe": "1 week", "goal": "achievable goal"},
        {"timeframe": "1 month", "goal": "achievable goal"}
    ],
    "encouragement": "personalized motivational message based on their performance"
}

RULES:
- Maximum 3 exercises, 2 resources
- Resources must be free and real (no made-up URLs)
- Match difficulty to ${level}
- Be specific and actionable
- Output ONLY the JSON object, nothing else`
};

// =============================================================================
// RESPONSE PARSER
// =============================================================================

function parseGeminiResponse(responseText) {
    // Try to extract JSON from the response
    let cleanJson = responseText.trim();
    
    // Remove markdown code blocks if present
    cleanJson = cleanJson.replace(/^```json\s*/i, '').replace(/^```\s*/i, '');
    cleanJson = cleanJson.replace(/\s*```$/i, '');
    
    // Try to find JSON object in the response
    const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        cleanJson = jsonMatch[0];
    }
    
    return JSON.parse(cleanJson);
}

// =============================================================================
// MAIN CLOUD FUNCTION
// =============================================================================

exports.geminiAssist = functions
    .runWith({
        secrets: ['GEMINI_API_KEY'],
        timeoutSeconds: 30,
        memory: '256MB',
        maxInstances: 10
    })
    .https.onCall(async (data, context) => {
        const startTime = Date.now();
        
        // Get client IP for rate limiting
        const ip = context.rawRequest?.headers?.['x-forwarded-for']?.split(',')[0] || 
                   context.rawRequest?.ip || 
                   'unknown';
        
        // Rate limit check
        const rateCheck = checkRateLimit(ip);
        if (!rateCheck.allowed) {
            console.warn(`Rate limit exceeded for IP: ${ip}`);
            throw new functions.https.HttpsError(
                'resource-exhausted',
                'Rate limit exceeded. Please wait before making more requests.',
                { retryAfter: 3600 }
            );
        }
        
        // Validate request
        const validationErrors = validateRequest(data);
        if (validationErrors.length > 0) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                validationErrors.join('; ')
            );
        }
        
        // Sanitize inputs
        const type = data.type;
        const level = data.level;
        const content = sanitizeInput(data.content);
        const additionalContext = sanitizeInput(data.additionalContext || '');
        const scores = data.scores || {};
        
        // Check API key
        if (!process.env.GEMINI_API_KEY) {
            console.error('GEMINI_API_KEY not configured');
            throw new functions.https.HttpsError(
                'failed-precondition',
                'AI service not configured. Please contact administrator.'
            );
        }
        
        // Build prompt based on type
        let prompt;
        switch (type) {
            case 'writing':
                prompt = PROMPTS.writing(level, additionalContext, content);
                break;
            case 'speaking':
                prompt = PROMPTS.speaking(level, additionalContext, content);
                break;
            case 'recommendations':
                prompt = PROMPTS.recommendations(level, scores, content);
                break;
            default:
                throw new functions.https.HttpsError('invalid-argument', 'Unknown request type');
        }
        
        try {
            // Initialize Gemini
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ 
                model: CONFIG.model,
                generationConfig: CONFIG.generationConfig
            });
            
            // Call Gemini API
            const result = await model.generateContent(prompt);
            const responseText = result.response.text();
            
            // Parse response
            let parsed;
            let parseWarning = null;
            
            try {
                parsed = parseGeminiResponse(responseText);
            } catch (parseError) {
                console.warn('JSON parse failed:', parseError.message);
                parseWarning = 'Response format was unexpected';
                parsed = { rawText: responseText.substring(0, 1000) };
            }
            
            // Log usage for monitoring
            const duration = Date.now() - startTime;
            console.log(`Gemini call: type=${type}, level=${level}, duration=${duration}ms, inputLen=${content.length}`);
            
            return {
                success: true,
                type: type,
                level: level,
                feedback: parsed,
                warning: parseWarning,
                rateLimit: {
                    remaining: rateCheck.remaining
                },
                timestamp: Date.now()
            };
            
        } catch (error) {
            console.error('Gemini API error:', error.message);
            
            // Handle specific Gemini errors
            if (error.message?.includes('quota')) {
                throw new functions.https.HttpsError(
                    'resource-exhausted',
                    'AI service quota exceeded. Please try again later.'
                );
            }
            
            if (error.message?.includes('safety')) {
                throw new functions.https.HttpsError(
                    'invalid-argument',
                    'Content could not be processed. Please revise and try again.'
                );
            }
            
            // Generic error
            throw new functions.https.HttpsError(
                'internal',
                'AI service temporarily unavailable. Please try again.'
            );
        }
    });

// =============================================================================
// HEALTH CHECK ENDPOINT (for monitoring)
// =============================================================================

exports.geminiHealth = functions.https.onRequest((req, res) => {
    // CORS headers
    res.set('Access-Control-Allow-Origin', '*');
    
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'GET');
        res.status(204).send('');
        return;
    }
    
    res.json({ 
        status: 'ok',
        service: 'Language Assessment AI',
        model: CONFIG.model,
        limits: {
            maxInputLength: CONFIG.maxInputLength,
            maxRequestsPerHour: CONFIG.maxRequestsPerHour
        },
        timestamp: new Date().toISOString()
    });
});
