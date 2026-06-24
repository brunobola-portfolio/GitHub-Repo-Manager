// Azure DevOps routes — thin aggregator. The former 739-line monolith mixed six
// concerns with divergent auth/limiter profiles; it's now split into focused
// sub-routers under the same /azure prefix (path-transparent), each carrying a
// single auth/limiter profile and independently testable:
//   - host-allowlist.js : env-auth probe + admin host-allowlist CRUD
//   - proxy.js          : PAT validate + project/repo/wiki/work-item/stats reads
//   - oauth.js          : Azure AD OAuth flow + org listing
//   - credentials.js    : per-user encrypted PAT vault CRUD + test
import express from 'express';
import hostAllowlistRouter from './azure/host-allowlist.js';
import proxyRouter from './azure/proxy.js';
import oauthRouter from './azure/oauth.js';
import credentialsRouter from './azure/credentials.js';

const router = express.Router();

router.use(hostAllowlistRouter);
router.use(proxyRouter);
router.use(oauthRouter);
router.use(credentialsRouter);

export default router;
