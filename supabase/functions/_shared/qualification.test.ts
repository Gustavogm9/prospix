import { assertEquals } from "jsr:@std/assert@1";
import {
  enforceQualificationResponse,
  normalizeQualificationAnswerSemantics,
  restrictQualificationAnswersToExpectedCriterion,
} from "./qualification.ts";

Deno.test("short answers cannot populate a different qualification criterion", () => {
  const answers = restrictQualificationAnswersToExpectedCriterion({
    message: "Sim, depende de mim",
    expectedCriterionKey: "professional_profile_confirmed",
    answers: [{
      criterion_key: "income_dependency",
      value: "HIGH",
      confidence: 0.95,
    }],
  });

  assertEquals(answers, []);
});

Deno.test("no current protection maps to NONE coverage despite the legacy gap key", () => {
  const answers = normalizeQualificationAnswerSemantics({
    message: "nenhuma infelizmente",
    answers: [{
      criterion_key: "protection_gap",
      value: "FULL",
      confidence: 0.8,
    }],
  });

  assertEquals(answers, [{
    criterion_key: "protection_gap",
    value: "NONE",
    confidence: 0.99,
  }]);
});

Deno.test("long explicit answers may populate more than the expected criterion", () => {
  const answer = {
    criterion_key: "income_dependency",
    value: "HIGH",
    confidence: 0.95,
  };
  const answers = restrictQualificationAnswersToExpectedCriterion({
    message:
      "Minha decisão é individual e eu perderia praticamente toda a renda se parasse de trabalhar por um mês",
    expectedCriterionKey: "decision_role",
    answers: [answer],
  });

  assertEquals(answers, [answer]);
});

Deno.test("in-progress responses contain only the configured next question", () => {
  const response = enforceQualificationResponse({
    text:
      "Segurança é manter sua renda. Você já tem reserva? Quer falar com alguém?",
    evaluation: {
      status: "IN_PROGRESS",
      score: 50,
      missingFields: ["decision_role"],
    },
    nextQuestion: {
      key: "decision_role",
      question:
        "Essa decisão passa por você ou costuma ser compartilhada com alguém?",
    },
  });

  assertEquals((response.match(/\?/g) || []).length, 1);
  assertEquals(
    response.endsWith(
      "Essa decisão passa por você ou costuma ser compartilhada com alguém?",
    ),
    true,
  );
});

Deno.test("disqualified responses never continue the interrogation", () => {
  const response = enforceQualificationResponse({
    text: "Entendi seu cenário. Você quer continuar? Posso ligar?",
    evaluation: { status: "DISQUALIFIED", score: 30, missingFields: [] },
  });

  assertEquals(response, "Entendi seu cenário.");
});
