import { z } from "zod";

type Translate = (key: string) => string;

export function createLoginSchema(t: Translate) {
  return z.object({
    email: z.string().min(1, t("auth.required")).email(t("auth.invalidEmail")),
    password: z.string().min(8, t("auth.passwordMin")),
  });
}

export function createRegisterSchema(t: Translate) {
  return createLoginSchema(t).extend({
    fullName: z.string().min(2, t("auth.required")),
  });
}

export type LoginValues = z.infer<ReturnType<typeof createLoginSchema>>;
export type RegisterValues = z.infer<ReturnType<typeof createRegisterSchema>>;
