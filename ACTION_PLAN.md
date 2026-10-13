# FairAI - Top 100 Action Plan

Use this as the final checklist before submission. The goal is not just to have a working app. The goal is to show a clear problem, measurable impact, Google AI usage, and a polished demo.

## Day 1: Run and Verify Locally

1. Get a Gemini API key from `https://aistudio.google.com`.
2. Start the backend:

```bash
cd backend
venv\Scripts\activate
set GEMINI_API_KEY=your_key_here
python app.py
```

3. Start the frontend:

```bash
cd frontend
npm start
```

4. Upload `sample_hiring_data.csv`.
5. Confirm these screens work:
   - Overview
   - Feature Analysis
   - AI Fix Suggestions
   - Before vs After

## Day 2: Polish the Story

Your judging story should be:

1. AI decisions can silently reproduce historical discrimination.
2. FairAI makes bias visible for non-technical teams.
3. FairAI explains which features drive the unfairness.
4. Gemini turns the audit into concrete data, model, and process fixes.
5. Reweighing shows measurable improvement in seconds.

Use the sample result:

- Female selection rate: 64.2%
- Male selection rate: 85.5%
- Demographic parity difference before: 0.213
- Disparate impact before: 0.751
- Demographic parity after mitigation: about 0.101
- Disparate impact after mitigation: about 0.890

## Day 3: Deploy

### Backend on Render

1. Push this repo to GitHub.
2. On render.com choose **New > Blueprint** and pick the repo; `render.yaml` does the rest.
3. Add `GEMINI_API_KEY` under Environment.
4. Copy the `https://fairai-api-xxxx.onrender.com` service URL.

### Frontend on Vercel

1. Set `REACT_APP_API_URL` in the Vercel dashboard to your Render backend URL.
2. Deploy the frontend folder on Vercel.
3. Test upload, suggestions, and mitigation on the live URL.

## Day 4: Record Demo Video

Use `DEMO_SCRIPT.md`. Keep it under 5 minutes.

Show this exact flow:

1. Open FairAI.
2. Upload `sample_hiring_data.csv`.
3. Show high bias in Overview.
4. Show Feature Analysis.
5. Click Gemini suggestions.
6. Apply the reweighing fix.
7. Show improved before/after metrics.

## Day 5: Build Deck and Submit

Make a 10-slide deck:

1. FairAI title and one-line value proposition.
2. Problem: biased automated decisions.
3. Target users: HR, banks, hospitals, NGOs, auditors.
4. Solution workflow: upload, detect, explain, fix, compare.
5. Live demo screenshots.
6. Architecture.
7. Google AI usage: Gemini suggestions.
8. Fairness metrics and sample impact.
9. SDG 10, SDG 8, SDG 16 impact.
10. Future scope: Google Cloud deployment, multi-language reports, audit logs, richer mitigations.

## Final Submission Checklist

- [ ] Live prototype URL works.
- [ ] Backend is deployed to Render and connected.
- [ ] Gemini suggestions work with your API key.
- [ ] GitHub repository is public.
- [ ] README is clean and in English.
- [ ] Demo video is clear and under 5 minutes.
- [ ] Deck includes Google AI usage and SDG impact.
- [ ] Submission text matches the demo and README.
