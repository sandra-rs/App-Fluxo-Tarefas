import assert from "node:assert/strict";
import { test } from "node:test";
import { agruparPorData, aguardandoAgente, rotuloStatus } from "../src/atendimento.js";

test("agrupa tickets por data como um histórico de conversas", () => {
  const agora = new Date(2026, 10, 11, 15, 0);
  const em = (dias, hora = 10) => new Date(2026, 10, 11 - dias, hora).toISOString();
  const tickets = [
    { id: "a", updatedAt: em(0) },
    { id: "b", updatedAt: em(1, 23) },
    { id: "c", updatedAt: em(3) },
    { id: "d", updatedAt: em(20) },
    { id: "e", updatedAt: em(90) },
  ];
  const grupos = agruparPorData(tickets, agora);
  assert.deepEqual(grupos.map((g) => [g.titulo, g.tickets.map((t) => t.id)]), [
    ["Hoje", ["a"]],
    ["Ontem", ["b"]],
    ["Últimos 7 dias", ["c"]],
    ["Últimos 30 dias", ["d"]],
    ["Mais antigos", ["e"]],
  ]);
  assert.deepEqual(agruparPorData([], agora), []);
});

test("aguardando agente só quando o usuário falou por último num ticket não resolvido", () => {
  const user = { author: "user" }, agent = { author: "agent" };
  assert.equal(aguardandoAgente({ status: "open" }, [user]), true);
  assert.equal(aguardandoAgente({ status: "in_progress" }, [user, agent]), false);
  assert.equal(aguardandoAgente({ status: "resolved" }, [user]), false);
  assert.equal(aguardandoAgente(null, [user]), false);
});

test("rótulos de status em português", () => {
  assert.equal(rotuloStatus("open"), "Aguardando resposta");
  assert.equal(rotuloStatus("in_progress"), "Em atendimento");
  assert.equal(rotuloStatus("resolved"), "Resolvido");
});
