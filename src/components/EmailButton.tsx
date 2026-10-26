import { EnvelopeSimple } from "@phosphor-icons/react/ssr";

// 首页唯一的主按钮：打开写给我的邮件。首屏和页尾用的是同一个
export function EmailButton({ email, label }: { email: string; label: string }) {
  return (
    <a
      href={`mailto:${email}`}
      className="inline-flex items-center gap-2 rounded-full bg-foreground px-3 py-2 text-base font-semibold text-background shadow-[0_0_32px_-8px_rgb(95_227_255/0.7)] transition hover:bg-white active:scale-[0.98]"
    >
      <EnvelopeSimple aria-hidden size={20} />
      {label}
    </a>
  );
}
