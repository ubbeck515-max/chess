/*
 * 체스닷컴 닉네임/레이팅 마스킹.
 *
 * 블러(모자이크) 대신 텍스트 자체를 중립적인 라벨로 바꾼다.
 *  - 닉네임  ->  Player 1, Player 2 ...  (같은 사람은 같은 번호)
 *  - 레이팅  ->  ----                    (레이팅 숨김을 켠 경우에만)
 *
 * 중요한 점: 마스킹은 "잎(leaf)" 요소에만 건다. 체스닷컴은 닉네임과 레이팅을
 * 한 컨테이너에 같이 넣는 경우가 많아서, 컨테이너째 건드리면 레이팅까지
 * 같이 가려진다. 그래서 내부에 또 다른 닉네임/레이팅 요소를 품고 있는
 * 요소는 건너뛴다.
 */

const DEFAULTS = {
  hideNames: true,
  hideRatings: false,
  peekOnHover: true,
};

const NAME_SELECTOR = [
  '[class*="user-username"]',
  '[class*="user-tagline-username"]',
  '[class*="player-username"]',
  '[class*="username-component"]',
  '[class*="profile-header-username"]',
  '[class*="user-popover-username"]',
  'a[href^="/member/"]',
  'a[href^="https://www.chess.com/member/"]',
].join(",");

const RATING_SELECTOR = [
  '[class*="user-tagline-rating"]',
  '[class*="user-rating"]',
  '[class*="player-rating"]',
  '[class*="-rating-white"]',
  '[class*="-rating-black"]',
  '[class*="rating-score"]',
  '[class*="profile-rating"]',
  /* 게임 리뷰의 "게임 레이팅"처럼 이름이 제각각인 자리까지 (레이팅 숨김을 켠 경우에만 쓰인다) */
  '[class*="rating"]',
].join(",");

const ANY_SELECTOR = NAME_SELECTOR + "," + RATING_SELECTOR;

const RATING_LABEL = "----";
const SCRUBBED_ATTRS = ["title", "aria-label", "alt", "data-tooltip"];

let settings = { ...DEFAULTS };
let observer = null;

/* 원래 텍스트 보관: 토글을 끄면 그대로 되돌린다. */
const originalText = new WeakMap(); // Text -> string
const maskedNodes = new Set(); // 되돌릴 대상 (약한 참조가 아니라 목록이 필요)

/* 닉네임 -> 번호. 같은 사람은 화면 어디서나 같은 번호를 받는다. */
const aliases = new Map(); // 소문자 닉네임 -> "Player N"
const knownNames = new Map(); // 소문자 닉네임 -> 원래 표기
let namePattern = null;

function aliasFor(name) {
  const key = name.trim().toLowerCase();
  if (!key) return "";
  if (!aliases.has(key)) aliases.set(key, `Player ${aliases.size + 1}`);
  if (!knownNames.has(key)) {
    knownNames.set(key, name.trim());
    namePattern = null; // 다시 만들어야 한다
  }
  return aliases.get(key);
}

/*
 * 게임 리뷰 패널이나 왼쪽 아래 내 계정처럼, 클래스 이름만으로는 못 찾는 자리가 있다.
 * 프로필 링크(/member/<닉네임>)에서 닉네임을 미리 배워 둔다.
 */
function learnNamesFromLinks(scope) {
  for (const link of collect(scope, 'a[href*="/member/"]')) {
    const slug = link.getAttribute("href").match(/\/member\/([^/?#]+)/);
    if (slug) aliasFor(decodeURIComponent(slug[1]));
  }
}

function buildNamePattern() {
  if (namePattern !== null) return namePattern;
  const names = [...knownNames.values()]
    .filter((n) => n.length >= 3)
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  namePattern = names.length ? new RegExp(`(?<![\\w-])(${names.join("|")})(?![\\w-])`, "gi") : false;
  return namePattern;
}

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "TITLE"]);

/* 선택자로 못 잡은 자리의 닉네임을 텍스트에서 직접 찾아 바꾼다. */
function sweepText(root) {
  if (!settings.hideNames) return;
  const pattern = buildNamePattern();
  if (!pattern) return;

  const scope = root.nodeType === Node.ELEMENT_NODE ? root : document.body;
  if (!scope) return;

  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.classList.contains("ca-masked")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const pending = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) pending.push(node);

  for (const node of pending) {
    pattern.lastIndex = 0;
    if (!pattern.test(node.nodeValue)) continue;

    if (!originalText.has(node)) originalText.set(node, node.nodeValue);
    pattern.lastIndex = 0;
    node.nodeValue = originalText.get(node).replace(pattern, (match) => aliasFor(match));
    maskedNodes.add(node);
    node.parentElement?.classList.add("ca-masked");
  }
}

/* 자식으로 또 다른 닉네임/레이팅 요소를 갖고 있으면 컨테이너다. */
function isLeaf(el) {
  return !el.querySelector(ANY_SELECTOR);
}

/* 요소 안의 텍스트 노드만 바꾼다. 국기·아이콘 같은 자식 요소는 건드리지 않는다. */
function maskElement(el, makeLabel) {
  let replaced = false;
  for (const node of el.childNodes) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const raw = node.nodeValue;
    if (!raw.trim()) continue;

    if (!originalText.has(node)) originalText.set(node, raw);
    const label = replaced ? "" : makeLabel(originalText.get(node));
    if (node.nodeValue !== label) node.nodeValue = label;
    maskedNodes.add(node);
    replaced = true;
  }
  if (replaced) el.classList.add("ca-masked");
}

function unmaskElement(el) {
  for (const node of el.childNodes) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    if (originalText.has(node)) {
      node.nodeValue = originalText.get(node);
      maskedNodes.delete(node);
    }
  }
  el.classList.remove("ca-masked");
}

function maskAll(root) {
  const scope = root.nodeType === Node.ELEMENT_NODE ? root : document;

  if (settings.hideNames) {
    for (const el of collect(scope, NAME_SELECTOR)) {
      if (isLeaf(el)) maskElement(el, (name) => aliasFor(name));
    }
  }
  if (settings.hideRatings) {
    for (const el of collect(scope, RATING_SELECTOR)) {
      if (isLeaf(el)) maskElement(el, () => RATING_LABEL);
    }
  }

  if (settings.hideNames) {
    learnNamesFromLinks(scope);
    /* 새 닉네임을 배웠다면 이미 지나간 화면도 그 이름으로 다시 훑는다. */
    const learnedSomethingNew = namePattern === null;
    sweepText(learnedSomethingNew ? document : scope);
  }
}

/* querySelectorAll은 root 자신을 포함하지 않으므로 직접 챙긴다. */
function collect(scope, selector) {
  const found = [...scope.querySelectorAll(selector)];
  if (scope.nodeType === Node.ELEMENT_NODE && scope.matches?.(selector)) found.push(scope);
  return found;
}

/*
 * 토글을 끌 때 되돌린다.
 * 레이팅 요소인지로 갈라야 한다: 선택자로 못 잡고 텍스트만 바꾼 자리(게임 리뷰
 * 패널, 왼쪽 아래 내 계정 등)는 어떤 닉네임 선택자에도 걸리지 않기 때문이다.
 */
function unmaskAll(kind) {
  for (const el of document.querySelectorAll(".ca-masked")) {
    const isRating = el.matches(RATING_SELECTOR);
    if (kind === "ratings" ? isRating : !isRating) unmaskElement(el);
  }
}

/* 툴팁으로 닉네임이 새는 걸 막는다. */
function scrubAttributes(root) {
  if (!settings.hideNames) return;
  for (const el of collect(root.nodeType === Node.ELEMENT_NODE ? root : document, NAME_SELECTOR)) {
    for (const attr of SCRUBBED_ATTRS) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      el.setAttribute("data-ca-" + attr, value);
      el.setAttribute(attr, "");
    }
  }
}

function restoreAttributes() {
  for (const attr of SCRUBBED_ATTRS) {
    for (const el of document.querySelectorAll("[data-ca-" + attr + "]")) {
      el.setAttribute(attr, el.getAttribute("data-ca-" + attr));
      el.removeAttribute("data-ca-" + attr);
    }
  }
}

/* "alice vs bob - Chess.com" 같은 탭 제목도 닉네임이다. */
let titleGuard = null;
function guardTitle() {
  titleGuard?.disconnect();
  titleGuard = null;
  if (!settings.hideNames) return;

  const titleEl = document.querySelector("title");
  if (!titleEl) return;

  const rewrite = () => {
    const masked = titleEl.textContent.replace(/^.*?\svs\.?\s.*?(?=\s[-|]|$)/i, "Chess");
    if (masked !== titleEl.textContent) titleEl.textContent = masked;
  };
  rewrite();
  titleGuard = new MutationObserver(rewrite);
  titleGuard.observe(titleEl, { childList: true, characterData: true, subtree: true });
}

/* 마우스를 올린 동안만 원래 값 보기. */
function onPointerOver(event) {
  if (!settings.peekOnHover) return;
  const el = event.target.closest?.(".ca-masked");
  if (!el) return;
  unmaskElement(el);
  el.addEventListener("mouseleave", () => refreshElement(el), { once: true });
}

function refreshElement(el) {
  if (settings.hideNames && el.matches(NAME_SELECTOR) && isLeaf(el)) {
    maskElement(el, (name) => aliasFor(name));
  } else if (settings.hideRatings && el.matches(RATING_SELECTOR) && isLeaf(el)) {
    maskElement(el, () => RATING_LABEL);
  } else if (settings.hideNames) {
    sweepText(el);
  }
}

function startObserver() {
  observer?.disconnect();
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "attributes") {
        scrubAttributes(m.target);
        continue;
      }
      for (const node of m.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        maskAll(node);
        scrubAttributes(node);
      }
      /* 앱이 다시 그리면서 원래 텍스트를 되돌려 놓는 경우 */
      if (m.type === "characterData") {
        const el = m.target.parentElement;
        if (el && !maskedNodes.has(m.target)) {
          originalText.delete(m.target);
          refreshElement(el);
        }
      }
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: SCRUBBED_ATTRS,
  });
}

function refresh() {
  document.documentElement.classList.remove("ca-booting");

  if (!settings.hideNames) unmaskAll("names");
  if (!settings.hideRatings) unmaskAll("ratings");
  maskAll(document);

  if (settings.hideNames) scrubAttributes(document);
  else restoreAttributes();

  guardTitle();
}

// 설정을 읽기 전까지는 닉네임을 잠시 감춰 둔다(깜빡임 방지).
document.documentElement.classList.add("ca-booting");

chrome.storage.sync.get(DEFAULTS, (stored) => {
  settings = { ...DEFAULTS, ...stored };
  refresh();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (key in settings) settings[key] = newValue;
  }
  refresh();
});

function boot() {
  refresh();
  startObserver();
  document.addEventListener("pointerover", onPointerOver, true);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
