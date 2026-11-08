# BP-Witness
GitHub repository for BP Witness

**A webcam referee for home blood pressure readings.**
Your blood pressure number is only as good as how you sat for it. BP Witness watches you take your reading, flags the mistakes that push the number up, reads the result off your monitor, and marks each reading as one your doctor can trust or not.

## The problem
Doctors adjust blood pressure medicine based on readings patients take at home, but very few people take them correctly. Common mistakes (crossed legs, an arm hanging down, talking, a cuff over a sleeve, skipping the 5-minute rest) can each raise the number by several mmHg, enough to change a treatment decision.

## How it works
1. **Setup:** prop your laptop about 2 m away so the camera sees your whole body and chair.
2. **Rest:** a 5-minute timer that only counts while you're sitting correctly, still and quiet.
3. **Measure:** a live checklist turns green or red while the cuff inflates.
4. **Capture:** hold the monitor's screen to the camera and AI reads the numbers.
5. **Result:** ✅ trusted or ⚠️ not trusted, with each mistake and its typical effect.
6. **History:** saved readings and a printable report for your doctor.

Along the way, **spoken coaching** says each fix out loud ("Uncross your legs") and a **camera framing check** tells you to move closer or back until your whole body is in view.

## Where the AI is
- **MediaPipe Pose Landmarker** (runs on your device) tracks 33 body points to check legs, back, arm position and movement.
- **Talking detection** (on your device) listens for speech-like sound. It ignores steady noise like the cuff's pump and the app's own voice.
- **Claude vision (Anthropic API)** does two jobs: checks a photo of your arm to confirm the cuff is on bare skin, not over a sleeve, and reads the numbers from a photo of the monitor screen.

**Privacy:** video and audio never leave the browser. Only the two photos you choose to send (cuff arm, monitor screen) go to the AI. Readings are saved only in your browser.

## Run it locally
You need [Node.js](https://nodejs.org) and a free [Vercel](https://vercel.com) account.

```bash
npm i -g vercel
copy .env.example .env.local     # then put your Anthropic API key in .env.local
vercel dev                        # opens http://localhost:3000
```

The camera only works on `localhost` or `https`. To try just the posture checks without the AI reader, run `npx serve .` and type the numbers in by hand.

## Deploy
Push to GitHub, import the repo in Vercel, and add `ANTHROPIC_API_KEY` under **Settings → Environment Variables**.

## Project structure
```
index.html          screens (setup, rest, measure, capture, result, history)
styles.css
src/app.js          step-by-step flow and the camera loop
src/vision.js       camera, microphone talking detector, MediaPipe pose, drawing
src/checks.js       posture rules, camera framing check and tuning thresholds
src/coach.js        spoken coaching with the browser's built-in voice
src/rules.js        each mistake, its typical effect and source
src/storage.js      saves readings in the browser
api/read-monitor.js reads the numbers off the monitor (Claude vision)
api/check-cuff.js   checks the cuff is on bare skin (Claude vision)
lib/claude.js       shared code for calling the Claude API
tests/              automated tests for the posture rules (npm test)
```

## Tuning
All posture thresholds are in `T` at the top of `src/checks.js`. If the cuff's pump gets flagged as talking, raise `TALK_MIN_VARIATION` in `src/vision.js`.

## Safety
BP Witness checks *how* a reading was taken. It does not diagnose anything or say whether a blood pressure is healthy. Users should share readings with their doctor and call emergency services if they feel unwell.

## Sources
- American Heart Association: how to measure blood pressure at home and common mistakes that raise readings
- Liu H. et al., *JAMA Internal Medicine*, 2024: arm position and blood pressure readings

## AI tools disclosure
- Starter code and this README were drafted with help from Claude (Anthropic) and then reviewed and edited by the team.
- The app uses MediaPipe (Google) for body tracking and the Claude API to read monitor screens.
