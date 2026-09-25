// A television collects its own sign-in once a phone has approved its pairing code.
// The approving account is known from the approval (pair_approve_account); this function then gives the television a
// session of its OWN for that account - so no two devices share a login, and signing one in never signs another out.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors })
const sha256 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
    .map(b => b.toString(16).padStart(2, '0')).join('')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  let code = '', secret = ''
  try { ({ code, secret } = await req.json()) } catch { return reply({ error: 'bad request' }, 400) }
  if (!/^[A-Za-z0-9]{6,12}$/.test(code || '') || (secret && !/^[0-9a-f]{32,128}$/.test(secret))) return reply({ error: 'bad request' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } })

  // a television waiting for approval holds the secret it was given with its code; a number OFFERED by a signed-in device
  // (pair_offer) is the credential itself - short-lived, and one open offer per account
  const { data: row } = await admin.from('pairings').select('code, approved_by, offered, secret_hash')
    .eq('code', code.toUpperCase()).gt('expires_at', new Date().toISOString()).maybeSingle()
  if (!row || (!row.offered && (!secret || row.secret_hash !== await sha256(secret)))) {
    await new Promise(r => setTimeout(r, 400))                   // guessing is slow
    return reply({ error: 'unknown or expired' }, 404)
  }
  if (!row.approved_by) return reply({ pending: true })

  const { data: u, error: ue } = await admin.auth.admin.getUserById(row.approved_by)
  if (ue || !u?.user?.email) return reply({ error: 'account' }, 500)
  const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.user.email })
  if (le || !link?.properties?.hashed_token) return reply({ error: 'link' }, 500)
  const { data: s, error: se } = await admin.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' })
  if (se || !s?.session) return reply({ error: 'session' }, 500)

  await admin.from('pairings').delete().eq('code', row.code)     // collected once
  return reply({ access_token: s.session.access_token, refresh_token: s.session.refresh_token, expires_in: s.session.expires_in })
})
