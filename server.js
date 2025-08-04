// server.js
//
// This Node.js server captures microphone audio, streams it to AssemblyAI's
// real-time transcription service and exposes the transcription via
// Server-Sent Events (SSE) to any connected browser clients. The server uses
// `node-record-lpcm16` to access the system microphone, the official
// AssemblyAI SDK for the streaming connection and Express to serve the
// front-end and SSE endpoint.

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const recorder = require('node-record-lpcm16');
const { AssemblyAI } = require('assemblyai');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());

// Serve static files from the `public` directory
app.use(express.static('public'));

// Keep a list of connected SSE clients. When new
// transcription data arrives we iterate through this array and write to
// each stream. When a client disconnects we remove it from the list.
let sseClients = [];

/**
 * Broadcasts a JSON serialisable object to all connected SSE clients.
 * Each message must end with a pair of newlines to comply with the SSE
 * protocol.
 *
 * @param {Object} data – the payload to send to the clients
 */
function broadcast(data) {
  const formatted = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((res) => {
    res.write(formatted);
  });
}

// SSE endpoint. Browsers connect here via EventSource. When a client
// disconnects (e.g. closing the tab) we clean up the entry from the
// `sseClients` array.
app.get('/events', (req, res) => {
  // Set the required headers to establish an SSE connection.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Immediately flush the headers so the client knows it’s connected.
  res.flushHeaders?.();
  // Send an initial comment so that some browsers fire the open event.
  res.write(': connected\n\n');
  // Keep the client alive by sending a periodic comment. Without this
  // EventSource connections may close when idle (e.g. proxies or CDNs).
  const keepAlive = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 20000);

  // Store the client response object so we can write to it later.
  sseClients.push(res);

  // Remove the client when it disconnects and clear the keepAlive timer.
  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients = sseClients.filter((client) => client !== res);
  });
});

/**
 * Starts streaming audio from the system microphone to AssemblyAI.
 * Sets up event handlers to forward both partial and final transcription
 * results to all connected SSE clients. If any errors occur during
 * streaming they are logged to the console.
 */
async function startStreaming() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    console.error('ASSEMBLYAI_API_KEY is not defined. Please set it in the environment.');
    return;
  }
  const client = new AssemblyAI({ apiKey });
  const realtime = client.realtime.createService({ sampleRate: 16000 });

  // When the websocket opens we log the session ID. Useful for debugging.
  realtime.on('open', ({ sessionId }) => {
    console.log('AssemblyAI real-time session started:', sessionId);
  });

  // When a partial transcript arrives, broadcast it. Partial transcripts
  // represent the words spoken so far and update as more audio is sent. We
  // include a `type` field so the front-end can treat partial and final
  // transcripts differently.
  realtime.on('transcript.partial', (msg) => {
    broadcast({ type: 'partial', text: msg.text });
  });

  // When a final transcript arrives, broadcast it. Final transcripts
  // correspond to complete utterances and will not change. Applications may
  // wish to store or display these permanently.
  realtime.on('transcript.final', (msg) => {
    broadcast({ type: 'final', text: msg.text });
  });

  // Log any errors that occur on the websocket connection.
  realtime.on('error', (err) => {
    console.error('AssemblyAI real-time error:', err);
  });

  // Establish the websocket connection. Without awaiting this call the
  // subsequent audio piping could begin before the connection is ready.
  await realtime.connect();

  // Start capturing audio from the microphone. We set the sample rate to
  // 16 kHz to match the settings used when connecting to AssemblyAI. The
  // `threshold` option is set to zero to stream all audio without
  // suppression, and `silence` to a high value to avoid stopping during
  // brief pauses.
  const mic = recorder.record({
    sampleRateHertz: 16000,
    threshold: 0,
    verbose: false,
    recordProgram: 'sox',
    silence: '10.0',
  });
  const micStream = mic.stream();

  // Handle errors from the microphone stream explicitly. Without this the
  // stream may silently fail.
  micStream.on('error', (err) => {
    console.error('Microphone error:', err);
  });

  // Pipe the raw PCM audio into AssemblyAI. The SDK provides a duplex
  // stream interface via `realtime.stream()`. Each chunk written will be
  // sent over the websocket. When the process exits the connection will
  // close automatically.
  micStream.pipe(realtime.stream());
}

// Start the Express server and, once listening, kick off the audio
// streaming. Should the streaming promise reject we log the error.
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  startStreaming().catch((err) => {
    console.error('Error starting streaming:', err);
  });
});
