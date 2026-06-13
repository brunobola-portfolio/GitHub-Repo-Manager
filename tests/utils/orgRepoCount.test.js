import { describe, it, expect } from 'vitest'
import { getOrgRepoCount } from '../../src/utils/orgRepoCount'

describe('getOrgRepoCount', () => {
	it('sums public and private repos', () => {
		expect(getOrgRepoCount({ public_repos: 10, total_private_repos: 5 })).toBe(15)
	})

	it('counts a private-only org instead of reporting 0 (the BolaLabs bug)', () => {
		expect(getOrgRepoCount({ public_repos: 0, total_private_repos: 7 })).toBe(7)
	})

	it('handles public-only orgs', () => {
		expect(getOrgRepoCount({ public_repos: 3 })).toBe(3)
	})

	it('treats missing fields as 0, never NaN', () => {
		expect(getOrgRepoCount({})).toBe(0)
		expect(getOrgRepoCount(null)).toBe(0)
		expect(getOrgRepoCount(undefined)).toBe(0)
	})
})
