chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_CAPTURE') {
    chrome.tabCapture.getMediaStreamId({ targetTabId: message.tabId }, (streamId) => {
      setupOffscreenDocument(streamId);
    });
  }
});

async function setupOffscreenDocument(streamId) {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (existingContexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Applying DSP to tab audio'
    });
  }
  chrome.runtime.sendMessage({ type: 'PROCESS_STREAM', streamId: streamId });
}