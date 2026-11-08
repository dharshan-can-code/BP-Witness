// The mistakes BP Witness looks for, and how much each one typically pushes a reading up.
//
// Sources (check every number before you submit, and cite them in your README):
// - American Heart Association, "How to measure your blood pressure at home"
//   https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings/monitoring-your-blood-pressure-at-home
// - Liu H. et al., JAMA Internal Medicine (Oct 2024): arm on lap +3.9 mmHg, arm hanging +6.5 mmHg systolic
//
// `id` values match the keys used in checks.js and app.js.

export const RULES = {
  // Seen by the camera / microphone
  legs: {
    label: "Feet flat, legs uncrossed",
    mistake: "Legs crossed or a foot off the floor",
    effect: "about +2 to 8 mmHg",
    fix: "Uncross your legs and put both feet flat on the floor.",
  },
  back: {
    label: "Back supported",
    mistake: "Leaning forward instead of sitting back",
    effect: "about +5 to 10 mmHg",
    fix: "Sit back so the chair supports your back.",
  },
  arm: {
    label: "Cuff arm resting at heart height",
    mistake: "Cuff arm hanging down or resting too low",
    effect: "about +4 to 10 mmHg",
    fix: "Rest your arm on a table so the cuff is level with your heart. A pillow under the arm helps.",
  },
  talking: {
    label: "Not talking",
    mistake: "Talking during the reading",
    effect: "about +10 mmHg",
    fix: "Stay silent until the cuff finishes.",
  },
  still: {
    label: "Staying still",
    mistake: "Moving during the reading",
    effect: "can make the reading unreliable",
    fix: "Keep still and relaxed.",
  },

  // Things the camera can't see, answered on the setup screen
  bareArm: {
    mistake: "Cuff over clothing",
    effect: "can add from 5 up to 50 mmHg",
  },
  bladder: {
    mistake: "Full bladder",
    effect: "about +10 to 15 mmHg",
  },
  noStimulants: {
    mistake: "Caffeine, exercise or smoking in the last 30 minutes",
    effect: "can raise the reading for a while",
  },

  // Timing
  rest: {
    mistake: "Skipped the 5 minutes of quiet rest",
    effect: "can raise the reading",
  },
};

// Checks shown live in the checklist, in display order
export const LIVE_CHECKS = ["legs", "back", "arm", "talking", "still"];
