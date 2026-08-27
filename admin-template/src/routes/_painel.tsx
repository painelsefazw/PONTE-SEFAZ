import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { sessaoAtual } from "@/lib/auth.functions";

export const Route = createFileRoute("/_painel")({
  beforeLoad: async () => {
    const s = await sessaoAtual();
    if (!s.authenticated) throw redirect({ to: "/" });
    return { user: s.user };
  },
  component: () => <Outlet />,
});
