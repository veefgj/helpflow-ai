// HelpFlow AI — widget loader. Embed snippet (Section 6):
//   <script src="https://widget.example.com/v1/loader.js" data-chatbot-id="<chatbotId>" async></script>
// The iframe stays launcher-sized while the chat is closed (so it never blocks the host page) and
// grows when the widget reports it opened; on phones the open chat is full-screen.
(function () {
  var script = document.currentScript;
  var chatbotId = script && script.getAttribute("data-chatbot-id");
  if (!chatbotId) {
    console.error("[HelpFlow] loader.js: missing data-chatbot-id attribute");
    return;
  }

  var MOBILE_MAX_WIDTH = 480; // keep in sync with COMPACT_MAX_WIDTH in chat-widget.tsx
  var origin = new URL(script.src).origin;
  var iframe = document.createElement("iframe");
  var isOpen = false;
  var isPeeking = false; // launcher hovered: room for the "Chat with …" label to its left

  iframe.src = origin + "/c/" + encodeURIComponent(chatbotId);
  iframe.title = "HelpFlow chat widget";
  iframe.setAttribute("allowtransparency", "true");
  iframe.style.cssText = [
    "position: fixed",
    "bottom: 0",
    "right: 0",
    "border: 0",
    "background: transparent",
    "z-index: 2147483000",
    "color-scheme: light",
  ].join(";");

  function applySize() {
    var style = iframe.style;
    if (!isOpen) {
      style.width = isPeeking ? "360px" : "104px"; // 56px launcher + 16px margin + room for its shadow (+ label)
      style.height = "104px";
    } else if (window.innerWidth <= MOBILE_MAX_WIDTH) {
      style.width = "100%";
      style.height = "100%";
    } else {
      style.width = "440px"; // 380px panel + margins + shadow
      style.height = "min(740px, 100%)";
    }
  }

  // The iframe can't see the host's viewport, so tell the widget whether the host is phone-sized
  // (full-screen chat) — a single boolean, sent only to the widget origin.
  function sendLayout() {
    if (!iframe.contentWindow) return;
    iframe.contentWindow.postMessage({ type: "helpflow:host", compact: window.innerWidth <= MOBILE_MAX_WIDTH }, origin);
  }

  // Only our own iframe, from the widget origin, may resize it — and the message carries nothing but two booleans.
  window.addEventListener("message", function (event) {
    if (event.source !== iframe.contentWindow || event.origin !== origin) return;
    var data = event.data;
    if (!data || data.type !== "helpflow:widget") return;
    isOpen = data.open === true;
    isPeeking = data.peek === true;
    applySize();
    sendLayout();
  });
  window.addEventListener("resize", function () {
    applySize();
    sendLayout();
  });

  applySize();
  document.body.appendChild(iframe);
})();
