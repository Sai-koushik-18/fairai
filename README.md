# FairAI - AI Bias Detection and Mitigation Platform

Built for Google Solution Challenge 2026, Problem Statement 4: Unbiased AI Decision.

FairAI helps teams audit decision datasets for bias, explain which features are driving unfair outcomes, and test mitigation before an AI system affects real people.

## Problem

AI systems now influence who gets shortlisted for jobs, approved for loans, or prioritized for services. If those systems learn from biased historical data, they can repeat and scale the same unfair patterns.

In India, this can show up in hiring datasets where gender, region, education background, or proxy variables quietly reduce opportunities for qualified candidates.

## Solution

FairAI gives non-experts a simple workflow:

1. Measure: upload a CSV dataset and get fairness metrics.
2. Flag: inspect group selection rates and model feature influence.
3. Fix: ask Gemini for actionable recommendations and apply a reweighing mitigation.
4. Compare: see before-versus-after fairness metrics.

## Key Features

- CSV upload with automatic sensitive-column and outcome-column detection.
- Demographic parity difference, disparate impact ratio, and equalized odds difference.
- Group selection-rate chart for clear storytelling.
- Model feature-importance view for explainability.
- Gemini-powered data, model, and process fix suggestions.
- Reweighing mitigation with before-versus-after comparison.
- Sample hiring dataset included for instant testing.

## Sample Result

Using `sample_hiring_data.csv`, FairAI detects:

- Female selection rate: 64.2%
- Male selection rate: 85.5%
- Demographic parity difference: 0.213
- Disparate impact ratio: 0.751

After the reweighing mitigation, the model fairness improves:

- Demographic parity difference: 0.101
- Disparate impact ratio: 0.890
- Equalized odds difference: 0.140

## SDG Alignment

| SDG | Impact |
| --- | --- |
| SDG 10: Reduced Inequalities | Detects and reduces unfair outcomes across demographic groups. |
| SDG 8: Decent Work and Economic Growth | Supports fairer hiring and opportunity access. |
| SDG 16: Peace, Justice and Strong Institutions | Promotes transparent, accountable automated decisions. |

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, Recharts, react-dropzone |
| Backend | Flask, Flask-CORS, pandas |
| Fairness and ML | Fairlearn, scikit-learn |
| AI Suggestions | Google Gemini API |
| Deployment | Vercel frontend, Render backend |

## Architecture

```text
CSV upload
  -> React frontend
  -> Flask API
  -> pandas validation
  -> Fairlearn metrics
  -> model feature explanation
  -> Gemini fix suggestions
  -> Dashboard and before/after comparison
```

## Local Setup

### Backend

Requires **Python 3.12.x**. The pinned `numpy==1.26.4` publishes no wheels for
Python 3.13+, so `pip install` will fail on newer interpreters. On Windows use
the `py` launcher to pick the right one.

```bash
cd backend
py -3.12 -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
set GEMINI_API_KEY=your_key_here
python app.py
```

The API runs at `http://localhost:5000`.

### Gemini Setup

To enable live AI recommendations:

1. Open [Google AI Studio](https://aistudio.google.com)
2. Create a Gemini API key
3. Set it before starting the backend

Recommended local setup: create `backend/.env` with your Gemini key.

```env
GEMINI_API_KEY=your_key_here
```

Then restart the backend.

Windows CMD:

```bat
cd backend
venv\Scripts\activate
set GEMINI_API_KEY=your_key_here
python app.py
```

Windows PowerShell:

```powershell
cd backend
.\venv\Scripts\Activate.ps1
$env:GEMINI_API_KEY="your_key_here"
python app.py
```

If no Gemini key is set, FairAI still works and returns offline fallback recommendations.

### Frontend

```bash
cd frontend
npm install
npm start
```

The app runs at `http://localhost:3000`.

## API Endpoints

| Endpoint | Method | Description |
| --- | --- | --- |
| `/` | GET | Health check |
| `/columns` | POST | Detect columns and preview sample rows |
| `/analyze` | POST | Upload CSV and return fairness analysis |
| `/suggest` | POST | Get Gemini fix suggestions |
| `/fix` | POST | Apply mitigation and return improved metrics |
| `/chat` | POST | Ask the FairAI assistant about the current audit |
| `/repair` | POST | Repair a dataset and return a downloadable cleaned CSV |

## Deployment

Recommended stack for submission:

- Frontend: Vercel
- Backend: Render
- AI: Gemini API

### Deploy Backend To Render

`render.yaml` in the repository root describes the service, so Render configures
itself from the repo.

1. Push this repository to GitHub.
2. On [render.com](https://render.com), choose **New > Blueprint** and select the repo.
3. Render reads `render.yaml` and creates the `fairai-api` web service on the free plan.
4. Add `GEMINI_API_KEY` under **Environment**. It is deliberately not stored in the file.
5. Wait for the first build. Installing pandas, scikit-learn and Fairlearn takes a few minutes.

After deploy, copy the `https://fairai-api-xxxx.onrender.com` service URL.

Free instances sleep after 15 minutes of inactivity and take roughly a minute to
wake, so open the URL once before any demo.

### Deploy Frontend To Vercel

Set `REACT_APP_API_URL` in Vercel to your Render backend URL, then deploy the `frontend` folder.

Example:

```env
REACT_APP_API_URL=https://fairai-api-xxxx.onrender.com
```

For local reference files, see [backend/.env.example](backend/.env.example), [frontend/.env.example](frontend/.env.example), and [frontend/.env.production.example](frontend/.env.production.example).

### Why This Stack Fits Solution Challenge

- Gemini API gives you a clear Google AI integration story.
- Render hosts the Python backend on its free plan, with no card required.
- Vercel is fine as an additional non-Google hosting tool because the project still uses Google technology directly.

## Submission Assets

- Prototype: deployed React app URL
- GitHub: public repository
- Demo video: under 5 minutes, showing upload, analysis, Gemini suggestions, and before/after comparison
- Project deck: problem, solution, architecture, SDG impact, demo screenshots, future scope

## Final Checklist

- The frontend opens and uploads CSV files correctly
- The backend returns `/columns`, `/analyze`, `/suggest`, and `/fix` responses
- The selected group column and outcome column are different
- The group column is not an identifier field such as `id`, `email`, or `phone`
- The outcome column contains at least two classes
- Gemini is configured and tested for live AI suggestions
- The deployed prototype link works on another device or browser
