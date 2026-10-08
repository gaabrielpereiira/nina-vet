// Envia o convite por email (via email de autenticação "invite") e liga o membro da equipe ao usuário.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Autenticação necessária" }, 401);
    const { data: c, error: uErr } = await supabase.auth.getClaims(token);
    if (uErr || !c?.claims?.sub) return json({ error: "Sua sessão expirou. Saia e entre novamente no sistema." }, 401);
    const u = { user: { id: c.claims.sub as string } };
    const { data: role } = await supabase.from("user_roles").select("role")
      .eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
    if (!role) return json({ error: "Apenas administradores podem convidar membros." }, 403);

    const body = await req.json().catch(() => ({}));
    const memberId = typeof body?.member_id === "string" ? body.member_id : "";
    const redirectTo = typeof body?.redirect_to === "string" && /^https?:\/\//.test(body.redirect_to) ? body.redirect_to : undefined;
    if (!memberId) return json({ error: "member_id obrigatório" }, 400);

    const { data: member } = await supabase.from("team_members").select("id, name, email").eq("id", memberId).maybeSingle();
    if (!member) return json({ error: "Membro não encontrado" }, 404);
    const email = String(member.email).trim().toLowerCase();

    const { data: inv, error: invErr } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { full_name: member.name },
    });
    if (invErr) {
      if (/already|registered|exists/i.test(invErr.message)) {
        // Conta já existe (ex.: convite reenviado): envia link de acesso para definir a senha
        const { error: rErr } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (rErr) return json({ error: `Não foi possível reenviar o link: ${rErr.message}` }, 400);
        const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const existing = list?.users?.find((x) => x.email?.toLowerCase() === email);
        if (existing) await supabase.from("team_members").update({ user_id: existing.id }).eq("id", member.id);
        return json({ success: true, resent: true });
      }
      return json({ error: `Não foi possível enviar o convite: ${invErr.message}` }, 400);
    }

    if (inv?.user?.id) {
      await supabase.from("team_members").update({ user_id: inv.user.id, status: "invited" }).eq("id", member.id);
    }
    return json({ success: true });
  } catch (e) {
    console.error("[invite-team-member]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
