"use client";

import Link from "next/link";
import { CircleHelp } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { HelpForRole } from "@/features/help/content";

interface HelpPageClientProps {
  help: HelpForRole;
}

export function HelpPageClient({ help }: HelpPageClientProps) {
  const { meta, sections, faq } = help;

  return (
    <div className="space-y-8">
      <Alert>
        <CircleHelp />
        <AlertTitle>Estás viendo la guía de {meta.label}</AlertTitle>
        <AlertDescription>{meta.intro}</AlertDescription>
      </Alert>

      <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
        <nav
          aria-label="Índice de ayuda"
          className="lg:sticky lg:top-20 lg:self-start space-y-1 pr-2"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Contenido
          </p>
          <ul className="space-y-0.5">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="block rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {section.title}
                </a>
              </li>
            ))}
            {faq.length > 0 ? (
              <li>
                <a
                  href="#faq"
                  className="block rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Preguntas frecuentes
                </a>
              </li>
            ) : null}
          </ul>
        </nav>

        <div className="min-w-0 space-y-10">
          {sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-24 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight">{section.title}</h2>
                <Badge variant="secondary">{meta.label}</Badge>
              </div>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph} className="text-sm text-muted-foreground leading-relaxed">
                  {paragraph}
                </p>
              ))}
              {section.steps?.length ? (
                <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">
                  {section.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              ) : null}
              {section.bullets?.length ? (
                <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
              {section.links?.length ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {section.links.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                    >
                      Ir a {link.label}
                    </Link>
                  ))}
                </div>
              ) : null}
              <Separator className="mt-6" />
            </section>
          ))}

          {faq.length > 0 ? (
            <section id="faq" className="scroll-mt-24 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight">Preguntas frecuentes</h2>
                <Badge variant="secondary">{meta.label}</Badge>
              </div>
              <Accordion>
                {faq.map((item) => (
                  <AccordionItem key={item.id} value={item.id}>
                    <AccordionTrigger>{item.question}</AccordionTrigger>
                    <AccordionContent>
                      <p className="text-muted-foreground">{item.answer}</p>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
