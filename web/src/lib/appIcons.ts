/* Surface — app-local icons, drawn to the Field System hairline spec (1.5px stroke via .ico, rounded caps
   and joins, 24-unit box, currentColor). Kept apart from the frozen set in icons.tsx, which stays
   unchanged. Every icon-only button that uses these carries an aria-label and a tooltip. */
export const APP_PATHS = {
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  mailDot: '<path d="M13 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6"/><path d="M3 7l9 6 4-2.7"/><circle cx="19" cy="5" r="2.5"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0"/>',
  bellOff: '<path d="M6 16V11a6 6 0 0 1 9.5-4.9M18 11v5l1.5 2H8M10 20a2 2 0 0 0 4 0M4 4l16 16"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/>',
  flash: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  signout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 8l-4 4 4 4M6 12h10"/>',
  bookmarkOn: '<path d="M6 4h12v16l-6-3-6 3z" fill="currentColor"/>',
  inbox: '<path d="M4 13l2-8h12l2 8v6H4zM4 13h5l1 2h4l1-2h5"/>',
  gear: '<path d="M19.0 10.3L21.4 10.5L21.4 13.5L19.0 13.7L18.2 15.7L19.7 17.6L17.6 19.7L15.7 18.2L13.7 19.0L13.5 21.4L10.5 21.4L10.3 19.0L8.3 18.2L6.4 19.7L4.3 17.6L5.8 15.7L5.0 13.7L2.6 13.5L2.6 10.5L5.0 10.3L5.8 8.3L4.3 6.4L6.4 4.3L8.3 5.8L10.3 5.0L10.5 2.6L13.5 2.6L13.7 5.0L15.7 5.8L17.6 4.3L19.7 6.4L18.2 8.3z"/><circle cx="12" cy="12" r="3"/>',
  text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
} as const;
