import { SignJWT, jwtVerify, generateKeyPair as joseGenerateKeyPair, exportPKCS8, exportSPKI, importSPKI, importPKCS8 } from 'jose'
import { randomUUID } from 'crypto'

export const LICENSE_PREFIX = 'grm_lic_'
const ALG = 'EdDSA'

export async function generateKeyPair() {
  const { privateKey, publicKey } = await joseGenerateKeyPair(ALG, { crv: 'Ed25519', extractable: true })
  return {
    privateKey: await exportPKCS8(privateKey),
    publicKey: await exportSPKI(publicKey),
  }
}

export async function generateLicenseKey(opts, privateKeyPem) {
  const { org, email, tier, seats, months } = opts
  const lid = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  const exp = months > 0
    ? now + (months * 30 * 24 * 60 * 60)
    : now - 1

  const key = await importPKCS8(privateKeyPem, ALG)
  const jwt = await new SignJWT({ lid, org, email, tier, seats })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key)

  return LICENSE_PREFIX + jwt
}

export async function validateLicenseKey(licenseKey, publicKeyPem) {
  try {
    if (!licenseKey || !licenseKey.startsWith(LICENSE_PREFIX)) return null
    const jwt = licenseKey.slice(LICENSE_PREFIX.length)
    const key = await importSPKI(publicKeyPem, ALG)
    const { payload } = await jwtVerify(jwt, key)
    return payload
  } catch {
    return null
  }
}

export function parseLicenseKey(licenseKey) {
  try {
    if (!licenseKey || !licenseKey.startsWith(LICENSE_PREFIX)) return null
    const jwt = licenseKey.slice(LICENSE_PREFIX.length)
    const parts = jwt.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    return payload
  } catch {
    return null
  }
}
