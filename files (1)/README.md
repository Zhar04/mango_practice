# Language Assessment App with Gemini AI

## 🚀 Deploy to GitHub Pages in 3 Steps

### Step 1: Get Your Gemini API Key
1. Go to https://aistudio.google.com/app/apikey
2. Click "Create API Key"
3. Copy the key

### Step 2: Add Your API Key to the Code
Open `index.html` and find this line (around line 396):
```javascript
const GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY_HERE';
```
Replace `YOUR_GEMINI_API_KEY_HERE` with your actual API key.

### Step 3: Deploy to GitHub Pages
1. Create a new GitHub repository
2. Upload `index.html` to the repository
3. Go to Settings → Pages
4. Set Source to "main" branch
5. Click Save

Your app will be live at: `https://yourusername.github.io/repository-name/`

---

## 🔒 Security Note

Your API key will be visible in the code. To minimize risk:

1. **Restrict your key** in Google Cloud Console:
   - Go to https://console.cloud.google.com/apis/credentials
   - Click your API key
   - Under "API restrictions" select "Restrict key"
   - Choose only "Generative Language API"

2. **Add website restrictions**:
   - Under "Website restrictions"
   - Add your GitHub Pages URL

3. **Monitor usage**:
   - Check https://console.cloud.google.com for unusual activity
   - If abused, just delete and create a new key

---

## ✨ AI Features

- **Writing Section**: Click "🤖 Get AI Feedback" to analyze student writing
- **Speaking Section**: Add your notes and click "🤖 Get AI Assessment Help"
- **Results Page**: Click "🎯 Generate Personalized Study Plan"

---

## 💰 Free Tier Limits

Gemini API free tier includes:
- 15 requests per minute
- 1 million tokens per month
- More than enough for typical teacher usage!
