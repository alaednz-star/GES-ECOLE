import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { createRegisterSchema, type RegisterValues } from "@/features/auth/schemas";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { ROLE_HOME } from "@/types/auth";

export function RegisterForm() {
  const { t } = useI18n();
  const { notifyError } = useActionFeedback();
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const form = useForm<RegisterValues>({
    resolver: zodResolver(createRegisterSchema(t)),
    defaultValues: { fullName: "", email: "", password: "" },
  });

  const onSubmit = async (values: RegisterValues) => {
    try {
      const user = await signUp(values);
      if (!user) {
        toast.success(t("auth.confirmEmailNotice"));
        navigate({ to: "/login", replace: true });
        return;
      }
      toast.success(t("auth.registerTitle"));
      // Public sign-ups are always students, and a new student has no academic
      // profile yet. Send them straight into the wizard rather than a dashboard
      // that would immediately bounce them there.
      navigate({
        to: user.role === "student" ? "/onboarding" : ROLE_HOME[user.role],
        replace: true,
      });
    } catch (error) {
      notifyError(error);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <FormField
          control={form.control}
          name="fullName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("auth.fullName")}</FormLabel>
              <FormControl>
                <Input autoComplete="name" className="h-11 rounded-xl" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("auth.email")}</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" className="h-11 rounded-xl" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("auth.password")}</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="new-password"
                  className="h-11 rounded-xl"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button
          type="submit"
          className="h-11 w-full rounded-xl"
          disabled={form.formState.isSubmitting}
        >
          {t("action.signUp")}
        </Button>
      </form>
    </Form>
  );
}
