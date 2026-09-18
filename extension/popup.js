const DEFAULTS = {
  hideNames: true,
  hideRatings: false,
  peekOnHover: true,
};

const inputs = Object.keys(DEFAULTS).map((key) => [key, document.getElementById(key)]);

chrome.storage.sync.get(DEFAULTS, (stored) => {
  for (const [key, input] of inputs) {
    input.checked = Boolean(stored[key]);
    input.addEventListener("change", () => {
      chrome.storage.sync.set({ [key]: input.checked });
    });
  }
});
