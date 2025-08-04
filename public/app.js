// Client-side logic for handling Server-Sent Events and updating the DOM.

(() => {
  const statusEl = document.getElementById('status');
  const transcriptsEl = document.getElementById('transcripts');
  let partialEl = null;

  // Create a new EventSource connection. This will automatically
  // reconnect if the network is interrupted.
  const evtSource = new EventSource('/events');

  evtSource.onopen = () => {
  	statusEl.textContent = 'Listening… speak into your microphone.';
  };

  evtSource.onerror = (err) => {
    console.error('SSE error:', err);
    statusEl.textContent = 'Connection error. Trying to reconnect…';
  };

  evtSource.onmessage = (event) => {
    // Each message contains a JSON string with at least a `type` and `text`.
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'partial') {
        // If we already have a partial transcript element, update its text.
        if (!partialEl) {
          partialEl = document.createElement('div');
          partialEl.className = 'partial';
          transcriptsEl.appendChild(partialEl);
        }
        partialEl.textContent = data.text;
      } else if (data.type === 'final') {
        // Append the final transcript and clear any partial.
        const finalEl = document.createElement('div');
        finalEl.className = 'final';
        finalEl.textContent = data.text;
        transcriptsEl.appendChild(finalEl);
        // Remove the partial element from the DOM and reset the reference.
        if (partialEl) {
          partialEl.remove();
          partialEl = null;
        }
      }
    } catch (e) {
      console.error('Failed to parse SSE data', e);
    }
  };
})();
