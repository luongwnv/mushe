// Resolves once the YouTube IFrame API is ready. The <script> tag is in
// index.html; window.YT becomes available asynchronously, and the API calls
// window.onYouTubeIframeAPIReady once. Multiple callers share one promise.

let readyPromise: Promise<typeof YT> | null = null;

export function ytReady(): Promise<typeof YT> {
  if (readyPromise) return readyPromise;
  readyPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT!);
    };
  });
  return readyPromise;
}
