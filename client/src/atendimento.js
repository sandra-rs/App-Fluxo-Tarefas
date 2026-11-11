// Lógica pura do atendimento (sem React), testada em client/test/atendimento.test.js.

export const STATUS = {
  open: { rotulo: "Aguardando resposta", tom: "aberto" },
  in_progress: { rotulo: "Em atendimento", tom: "andamento" },
  resolved: { rotulo: "Resolvido", tom: "resolvido" },
};

export const rotuloStatus = (status) => STATUS[status]?.rotulo ?? status;

const inicioDoDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Agrupa tickets como o histórico de conversas: Hoje, Ontem, Últimos 7 dias, Últimos 30 dias, Mais antigos. */
export function agruparPorData(tickets, agora = new Date()) {
  const hoje = inicioDoDia(agora);
  const dia = 86_400_000;
  const faixas = [
    { titulo: "Hoje", desde: hoje },
    { titulo: "Ontem", desde: hoje - dia },
    { titulo: "Últimos 7 dias", desde: hoje - 7 * dia },
    { titulo: "Últimos 30 dias", desde: hoje - 30 * dia },
    { titulo: "Mais antigos", desde: -Infinity },
  ];
  const grupos = faixas.map((f) => ({ titulo: f.titulo, tickets: [] }));
  for (const t of tickets) {
    const quando = new Date(t.updatedAt).getTime();
    const i = faixas.findIndex((f) => quando >= f.desde);
    grupos[i === -1 ? grupos.length - 1 : i].tickets.push(t);
  }
  return grupos.filter((g) => g.tickets.length);
}

/** O usuário falou por último e o ticket não está resolvido: falta a resposta do agente. */
export function aguardandoAgente(ticket, mensagens) {
  if (!ticket || ticket.status === "resolved" || !mensagens.length) return false;
  return mensagens[mensagens.length - 1].author === "user";
}

/** Hora para mensagens de hoje; dia e hora para as demais. */
export function horario(iso, agora = new Date()) {
  const d = new Date(iso);
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (inicioDoDia(d) === inicioDoDia(agora)) return hora;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}, ${hora}`;
}
