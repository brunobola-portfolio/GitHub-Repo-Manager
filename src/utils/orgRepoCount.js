/**
 * Total repositories owned by an org/account, as shown in "N repos" labels.
 *
 * GitHub splits the count into `public_repos` and `total_private_repos` (the
 * latter populated by `GET /orgs/{org}` / `GET /user` for members with
 * visibility). Showing only `public_repos` makes a private-only org read as
 * "0 repos" — which is exactly the BolaLabs bug. Always sum both.
 *
 * Both fields default to 0 when absent (e.g. an org the user can't see private
 * counts for), so the result is the visible total, never NaN.
 *
 * @param {{ public_repos?: number, total_private_repos?: number } | null | undefined} org
 * @returns {number}
 */
export function getOrgRepoCount(org) {
	if (!org) return 0
	return (org.public_repos || 0) + (org.total_private_repos || 0)
}
