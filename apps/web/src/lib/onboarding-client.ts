import { z } from 'zod';
export const onboardingClientSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do cliente.').max(160, 'Use até 160 caracteres no nome.'),
  whatsapp: z.string().trim().refine(value => {
    const digits = value.replace(/\D/g, '');
    return /^[+\d\s().-]+$/.test(value) && (digits.length === 10 || digits.length === 11 || (/^55\d{10,11}$/.test(digits)));
  }, 'Informe um WhatsApp válido com DDD.').transform(value => {
    const digits = value.replace(/\D/g, '');
    return digits.length <= 11 ? `55${digits}` : digits;
  }),
  email: z.union([z.literal(''), z.string().trim().email('Confira o e-mail informado.')]),
  city: z.string().trim().max(120, 'Use até 120 caracteres na cidade.'),
}).strict();
