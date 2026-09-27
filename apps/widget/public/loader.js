// HelpFlow AI — widget loader. Embed snippet (Section 6):
//   <script src="https://widget.example.com/v1/loader.js" data-chatbot-id="<chatbotId>" async></script>
(function () {
  var script = document.currentScript;
  var chatbotId = script && script.getAttribute("data-chatbot-id");
  if (!chatbotId) {
    console.error("[HelpFlow] loader.js: missing data-chatbot-id attribute");
    return;
  }

  var origin = new URL(script.src).origin;
  var iframe = document.createElement("iframe");
  iframe.src = origin + "/c/" + encodeURIComponent(chatbotId);
  iframe.title = "HelpFlow chat widget";
  iframe.style.cssText = [
    "position: fixed",
    "bottom: 16px",
    "right: 16px",
    "width: 380px",
    "height: 600px",
    "max-width: calc(100vw - 32px)",
    "max-height: calc(100vh - 32px)",
    "border: 0",
    "z-index: 2147483000",
    "color-scheme: light",
  ].join(";");
  iframe.setAttribute("allowtransparency", "true");

  document.body.appendChild(iframe);
})();
