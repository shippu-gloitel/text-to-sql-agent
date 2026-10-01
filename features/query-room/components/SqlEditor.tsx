import { useId, type KeyboardEvent } from 'react';
import { SqlTokens } from './SqlCode';

const INDENT = '  ';

/**
 * A small SQL editor: a transparent textarea over a highlighted copy of the same text, so the
 * editing view looks like the read-only SQL view. The highlighted layer sizes the editor.
 */
export default function SqlEditor({
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const hintId = useId();
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    } else if (event.key === 'Tab' && !event.shiftKey) {
      // Indent instead of leaving the editor; insertText keeps the browser's undo history.
      event.preventDefault();
      const textarea = event.currentTarget;
      if (!document.execCommand('insertText', false, INDENT)) {
        textarea.setRangeText(INDENT, textarea.selectionStart, textarea.selectionEnd, 'end');
        onChange(textarea.value);
      }
    }
  };

  return (
    <>
      <div className='sql-editor'>
        <pre className='code sql-editor-highlight' aria-hidden='true'>
          <code>
            <SqlTokens sql={value} />
            {/* Keeps a trailing newline visible so the caret line has height. */}
            {'\n'}
          </code>
        </pre>
        <textarea
          className='code sql-editor-input'
          value={value}
          onChange={event => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label='Edit SQL'
          aria-describedby={hintId}
          spellCheck={false}
          autoCapitalize='off'
          autoCorrect='off'
          autoComplete='off'
          autoFocus
          onFocus={event => {
            const end = event.currentTarget.value.length;
            event.currentTarget.setSelectionRange(end, end);
          }}
        />
      </div>
      <p className='sql-editor-hint' id={hintId}>
        <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Enter</kbd> to re-check · <kbd>Esc</kbd> to cancel ·{' '}
        <kbd>Tab</kbd> to indent
      </p>
    </>
  );
}
