'use client';

import type { ChangeEvent, ReactNode, Ref } from 'react';
import { SearchIcon } from '@/components/icons/ToolIcons';

/**
 * The search box every list opens with: a magnifier, the field, and whatever
 * the surface puts after it — a clear button while there is a query, or the
 * way out of a popover.
 *
 * `className` and `inputClassName` are the surface's own names (`browser-search`,
 * `browser-search-input`), which the stylesheet and the tests still key on;
 * `filter-field` and `filter-input` are the shared anatomy and are always there.
 */
export function SearchField({
  className,
  inputClassName,
  value,
  onChange,
  placeholder,
  iconSize = 14,
  inputRef,
  trailing,
}: {
  className: string;
  inputClassName: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  iconSize?: number;
  inputRef?: Ref<HTMLInputElement>;
  /** What sits after the field: a clear button, a close button, nothing. */
  trailing?: ReactNode;
}) {
  return (
    <div className={`${className} filter-field`}>
      <SearchIcon size={iconSize} />
      <input
        ref={inputRef}
        className={`${inputClassName} filter-input`}
        placeholder={placeholder}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      />
      {trailing}
    </div>
  );
}
