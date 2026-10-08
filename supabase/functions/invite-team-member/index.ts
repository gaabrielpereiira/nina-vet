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
    const { data: u, error: uErr } = await supabase.auth.getUser(token);
    if (uErr || !u?.user) return json({ error: "Sessão inválida" }, 401);
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
      const msg = /already|registered|exists/i.test(invErr.message)
        ? "Este email já tem uma conta. A pessoa pode entrar direto pela tela de login (ou usar 'Esqueci a senha')."
        : `Não foi possível enviar o convite: ${invErr.message}`;
      return json({ error: msg }, 400);
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
