# FairAI - Demo Video Script

Target length: 3 to 4 minutes.

## 0:00-0:30 - Problem

Hello, I am presenting FairAI, an AI bias detection and fixing tool for Google Solution Challenge 2026, under Problem Statement 4: Unbiased AI Decision.

AI systems are increasingly used in high-impact decisions like hiring, loan approval, and healthcare access. But if these systems are trained on biased historical data, they can repeat unfair patterns at scale.

FairAI helps teams detect that bias, understand what is causing it, and test a mitigation before the model affects real people.

## 0:30-1:10 - Upload and Detect

I will upload a sample hiring dataset with 300 candidates. It includes gender, region, education, experience, skills score, and hiring outcome.

After clicking Run audit, FairAI automatically detects the sensitive column and the outcome column.

The dashboard shows three fairness metrics. In this sample, female candidates are selected at 64.2%, while male candidates are selected at 85.5%. That creates a demographic parity difference of 0.213 and a disparate impact ratio of 0.751, which is below the common 80 percent fairness rule.

This tells us the dataset contains a high-risk bias pattern.

## 1:10-1:45 - Explain Bias

Now I will open Feature Analysis.

FairAI trains a random forest on the dataset and reports its feature importances, showing which columns influence the decision model the most. This is important because teams should not only know that bias exists. They should also know where to investigate.

Here, gender and region appear alongside legitimate factors like skills score and experience, which signals that sensitive or proxy variables may be influencing the decision process.

## 1:45-2:30 - Gemini Suggestions

Next, I will click AI Fix Suggestions.

FairAI sends the fairness report to Google's Gemini API and asks for three targeted recommendations: a data fix, a model fix, and a process fix.

This makes the tool useful for non-technical teams. Instead of only showing metrics, it translates the audit into practical next steps, such as improving representation in the dataset, applying fairness-aware training, and using blind screening in the hiring workflow.

## 2:30-3:15 - Apply Mitigation

Finally, I will open Before vs After and apply the reweighing fix.

FairAI retrains the model with balanced sample weights and compares the new fairness metrics.

In this demo, demographic parity improves from 0.213 to about 0.101, and disparate impact improves from 0.751 to about 0.890. That means the model moves from failing the 80 percent rule to passing it.

## 3:15-3:45 - Close

FairAI addresses SDG 10 by reducing inequality, SDG 8 by supporting fair access to work, and SDG 16 by making automated decisions more transparent and accountable.

It is built with React, Flask, Fairlearn, scikit-learn, and Google Gemini.

Thank you.

## Recording Tips

- Record at 1080p.
- Keep browser zoom at 100%.
- Use `sample_hiring_data.csv`.
- Do one practice run before recording.
- Keep the final video under 5 minutes.
- Upload to YouTube as Unlisted and use that link in the submission.
