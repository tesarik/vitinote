// Jediný <dialog> pro všechny formuláře: openForm/closeForm a uložení po odeslání.
import { $ } from './util.js';
import { save } from './storage.js';
import { render } from './views.js';

export const dlg = $('#dlg');
export const form = $('#dlg-form');
export let currentSubmit = null;
export let currentDelete = null;

export function openForm({ title, body, onSubmit, onDelete, onInit }) {
  $('#dlg-title').textContent = title;
  $('#dlg-body').innerHTML = body;
  currentSubmit = onSubmit;
  currentDelete = onDelete || null;
  $('#dlg-delete').hidden = !onDelete;
  dlg.showModal();
  onInit?.();
  const first = $('input:not([type=hidden]):not([type=checkbox]), select, textarea', form);
  if (first && window.matchMedia('(pointer: fine)').matches) first.focus();
}

export function closeForm() {
  dlg.close();
  currentSubmit = currentDelete = null;
}

// Volá main.js po načtení stránky.
export function initDialog() {
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const get = k => String(fd.get(k) ?? '').trim();
    if (currentSubmit?.(get, fd) === false) return;
    save();
    closeForm();
    render();
  });

  $('#dlg-delete').addEventListener('click', () => {
    if (currentDelete?.() === false) return;
    save();
    closeForm();
    render();
  });
}
