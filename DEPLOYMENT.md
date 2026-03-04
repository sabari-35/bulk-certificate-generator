# Free Cloud Deployment Guide

To host this Certificate Generator on the public internet for free, you will need to host your **Frontend (React)** and **Backend (Python)** separately.

Here is the best combination of 100% free services to use:
- **Backend:** [Render.com](https://render.com) (Free "Web Service")
- **Frontend:** [Vercel](https://vercel.com) (Free "Hobby" Tier)

---

## Step 1: Push your code to GitHub
Both Render and Vercel work by linking directly to your GitHub repository.
If you haven't recently, make sure to commit your latest code and push it to a public or private GitHub repository.

## Step 2: Deploy Backend to Render (Free)
Render will run your FastAPI python server in the cloud.

1. Go to [Render.com](https://render.com) and create a free account linked to your GitHub.
2. Click **New +** -> **Web Service**.
3. Select your `certification` GitHub repository.
4. Fill out the configuration:
   - **Name:** `cert-backend`
   - **Root Directory:** `backend`
   - **Environment:** `Python 3`
   - **Build Command:** `pip install -r requirements.txt` (Make sure you have a `requirements.txt` in your backend folder. Run `pip freeze > requirements.txt` locally if you haven't).
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port 10000`
5. Select the **Free** instance type.
6. Click **Create Web Service**. 

*Wait about 3-5 minutes for it to build. Once it says "Live", copy the URL they give you (e.g., `https://cert-backend.onrender.com`). Add `/api` to the end of it.*

---

## Step 3: Deploy Frontend to Vercel (Free)
Vercel will host your dynamic React interface.

1. Go to [Vercel.com](https://vercel.com) and sign in with GitHub.
2. Click **Add New** -> **Project**.
3. Import your `certification` repository.
4. Fill out the configuration:
   - **Framework Preset:** `Vite`
   - **Root Directory:** Edit this and select `frontend`.
5. Open the **Environment Variables** drop-down:
   - Name: `VITE_API_URL`
   - Value: Paste your Render URL with `/api` at the end (e.g., `https://cert-backend.onrender.com/api`).
6. Click **Deploy**.

*Wait about 1-2 minutes. Vercel will give you a public URL (e.g., `https://certification-frontend.vercel.app`).*

---

## Step 4: Finished!
You can now access your Vercel URL from any computer or phone in the world, and it will communicate directly with your free Render Python server securely!

> **Warning regarding Free Tiers:**
> Because Render provides the backend for free, if no one uses your tool for 15 minutes, Render will "spin down" the server to save money. 
> This means the *very first time* you open the website after being away for a while, it might take **50 seconds to 1 minute** to wake up the backend before you can generate certificates. After it wakes up, it will run super-fast again!
