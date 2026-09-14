import { useNavigate } from 'react-router';
import ReactMarkdown, { type Components } from 'react-markdown';
import { toast } from '@/components/ui/toastStore';
import { resolveDestination } from '@/lib/destinations';
import { usePlatform, useRepository } from '@/platform';
import { classifyHref } from './markdownLinks';

/**
 * The Markdown preview (week 12): react-markdown with raw HTML dropped, no
 * MDX or HTML plugins, images replaced by their alt text, and every link
 * classified by `classifyHref` — external ones open in a new context only
 * after a click, `orbit://` ones through the typed resolver, the rest as
 * plain text. The body is rendered as given; nothing is rewritten or saved.
 * Loaded lazily so the editor does not pay for it until preview is shown.
 */
export default function NotePreview({ body }: { body: string }) {
  const platform = usePlatform();
  const repo = useRepository();
  const navigate = useNavigate();

  const components: Components = {
    a: ({ href, children }) => {
      const link = classifyHref(href);
      if (link.kind === 'external') {
        return (
          <a
            href={link.url}
            rel="noopener noreferrer"
            target="_blank"
            className="underline"
            onClick={(e) => {
              e.preventDefault();
              void platform.openExternal(link.url);
            }}
          >
            {children}
          </a>
        );
      }
      if (link.kind === 'internal') {
        return (
          <button
            type="button"
            className="underline"
            data-testid="internal-link"
            onClick={() =>
              void resolveDestination(repo, link.destination)
                .then((r) => navigate(r.path))
                .catch((err: unknown) =>
                  toast({
                    title: 'Could not open the link',
                    description: err instanceof Error ? err.message : String(err),
                    variant: 'danger',
                  }),
                )
            }
          >
            {children}
          </button>
        );
      }
      return (
        <span
          className="text-ink-muted"
          data-testid="blocked-link"
          title="This link cannot be opened."
        >
          {children}
        </span>
      );
    },
    img: ({ alt }) => (
      <span
        className="inline-block rounded border border-dashed border-line px-1.5 text-[12px] text-ink-faint"
        data-testid="image-placeholder"
      >
        [image{alt ? `: ${alt}` : ''}]
      </span>
    ),
  };

  return (
    <div className="prose-orbit text-sm leading-6 text-ink" data-testid="note-preview">
      <ReactMarkdown skipHtml components={components} urlTransform={(url) => url}>
        {body}
      </ReactMarkdown>
    </div>
  );
}
