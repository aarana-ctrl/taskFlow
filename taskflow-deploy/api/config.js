/* TaskFlow — serves Firebase config to the client.
 * Set these in Vercel → Settings → Environment Variables:
 *   FIREBASE_API_KEY
 *   FIREBASE_AUTH_DOMAIN   (e.g. your-project.firebaseapp.com)
 *   FIREBASE_PROJECT_ID    (e.g. your-project)
 *   FIREBASE_APP_ID        (e.g. 1:123456789:web:abc123)
 */
module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  var apiKey     = process.env.FIREBASE_API_KEY     || '';
  var authDomain = process.env.FIREBASE_AUTH_DOMAIN || '';
  var projectId  = process.env.FIREBASE_PROJECT_ID  || '';
  var appId      = process.env.FIREBASE_APP_ID      || '';

  res.status(200).json({
    apiKey,
    authDomain,
    projectId,
    appId,
    configured: !!(apiKey && authDomain && projectId && appId),
  });
};
