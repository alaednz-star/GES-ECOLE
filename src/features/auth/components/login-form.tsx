import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "@tanstack/react-router";
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
import { createLoginSchema, type LoginValues } from "@/features/auth/schemas";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { ROLE_HOME } from "@/types/auth";

export function LoginForm() {
  const { t } = useI18n();
  const { notifyError } = useActionFeedback();
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const form = useForm<LoginValues>({
    resolver: zodResolver(createLoginSchema(t)),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values: LoginValues) => {
    try {
      const user = await signIn(values);
      toast.success(t("auth.welcome"));
      await navigate({ to: ROLE_HOME[user.role], replace: true });
    } catch (error) {
      notifyError(error);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("auth.email")}</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="admin@centre.dz"
                  className="h-11 rounded-xl"
                  {...field}
                />
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
              <div className="flex items-center justify-between gap-2">
                <FormLabel>{t("auth.password")}</FormLabel>
                <Link
                  to="/forgot-password"
                  className="focus-ring rounded text-xs font-medium text-primary"
                >
                  {t("auth.forgotPassword")}
                </Link>
              </div>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
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
          {t("action.signIn")}
        </Button>

        <p className="text-xs text-muted-foreground">{t("auth.demoNotice")}</p>
      </form>
    </Form>
  );
}
