interface Props {
  title: string;
  description?: string;
}

export function Placeholder({ title, description }: Props) {
  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-3xl">
      <h1 id="page-title" className="text-display font-semibold tracking-tight text-ink">
        {title}
      </h1>
      {description ? <p className="mt-2 text-ink-muted">{description}</p> : null}
    </section>
  );
}
