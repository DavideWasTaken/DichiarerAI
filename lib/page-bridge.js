(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DichiarerPageBridge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function scrapePage(readSessionId, skipNonTaxPage) {
    const normalize = (value, limit) => String(value || '')
      .replace(/\s+/g, ' ').trim().slice(0, limit || Infinity);
    const allowed = new Set(['text', 'number', 'date', 'month', 'email', 'tel', 'checkbox', 'radio']);
    const disabled = (element) => { try { return element.matches(':disabled'); } catch (_) { return Boolean(element.disabled); } };
    const visible = (element) => {
      if (!element.isConnected || element.hidden) return false;
      for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
        const style = window.getComputedStyle(node); if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
      return true;
    };
    document.querySelectorAll('[data-dichiarerai-id],[data-dichiarerai-session]')
      .forEach((element) => {
      delete element.dataset.dichiareraiId;
      delete element.dataset.dichiareraiSession;
    });
    const labelFor = (element) => {
      if (element.id) {
        const explicit = Array.from(document.querySelectorAll('label'))
          .find((label) => label.htmlFor === element.id);
        if (explicit) return normalize(explicit.textContent, 160);
      }
      const aria = element.getAttribute('aria-label');
      if (aria) return normalize(aria, 160);
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const text = labelledBy.split(/\s+/)
          .map((id) => (document.getElementById(id) || {}).textContent || '').join(' ');
        if (normalize(text, 160)) return normalize(text, 160);
      }
      const wrapper = element.closest('label');
      if (wrapper) return normalize(wrapper.textContent, 160);
      return normalize(element.getAttribute('placeholder') || element.name ||
        element.id, 160);
    };
    const headings = Array.from(document.querySelectorAll(
      'h1,h2,h3,h4,h5,h6,legend,[role="heading"]')).filter(visible);
    const sectionFor = (element) => {
      let section = '';
      for (const heading of headings) {
        if (heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
          section = normalize(heading.textContent, 240);
      }
      return section;
    };
    const contextFor = (element) => {
      const row = element.closest('tr,li,fieldset,[class*="rigo"],'+
        '[class*="row"],[class*="Row"]');
      return row ? normalize(row.textContent, 240) : '';
    };
    const markerPattern = /\b(?:dichiarazione|730|redditi|quadro|rigo|[a-z]{1,3}\d{1,3})\b/i;
    const markerElements = document.querySelectorAll('h1,h2,h3,h4,h5,h6,'+
      'legend,[role="heading"],tr,li,fieldset,[class*="rigo"],[class*="row"],[class*="Row"]');
    const hasMarker = Array.from(markerElements).some((element) =>
      visible(element) && markerPattern.test(element.textContent || ''));
    if (!hasMarker) {
      if (skipNonTaxPage) return null;
      const error = new Error('La pagina non sembra una dichiarazione dei redditi.');
      error.code = 'NOT_TAX_FORM'; throw error;
    }
    const eligible = Array.from(document.querySelectorAll('input,select,textarea'))
      .filter((element) => {
      const tag = element.tagName.toLowerCase();
      const type = tag === 'input' ? String(element.type).toLowerCase() : tag;
      return !((tag === 'input' && !allowed.has(type)) ||
        (tag !== 'input' && tag !== 'select' && tag !== 'textarea') ||
        !visible(element) || disabled(element) || element.readOnly);
      });
    eligible.forEach((element, localId) => {
      element.dataset.dichiareraiId = String(localId);
      element.dataset.dichiareraiSession = String(readSessionId);
    });
    const radioElements = Array.from(document.querySelectorAll('input[type="radio"]'))
      .filter(visible);
    let nextPeerId = eligible.length;
    radioElements.filter((element) => !element.dataset.dichiareraiId)
      .forEach((element) => {
        element.dataset.dichiareraiId = String(nextPeerId++);
        element.dataset.dichiareraiSession = String(readSessionId);
      });
    const snapshot = (element) => {
      const localId = Number(element.dataset.dichiareraiId);
      const tag = element.tagName.toLowerCase();
      const type = tag === 'input' ? String(element.type).toLowerCase() : tag;
      const isCheckable = type === 'checkbox' || type === 'radio';
      const selected = tag === 'select' ? element.selectedOptions[0] : null;
      return {
        localId, readSessionId: String(readSessionId), tag, tipo: type,
        name: element.name || '', optionValue: type === 'radio' ? element.value : '',
        valore: isCheckable
          ? String(Boolean(element.checked))
          : (selected ? normalize(selected.textContent) : element.value || ''),
        checked: Boolean(element.checked), disabled: disabled(element),
        readOnly: Boolean(element.readOnly), required: Boolean(element.required),
        min: element.getAttribute('min') || '', max: element.getAttribute('max') || '',
        step: element.getAttribute('step') || '', pattern: element.getAttribute('pattern') || '',
        maxLength: typeof element.maxLength === 'number' ? element.maxLength : -1,
        etichetta: labelFor(element), sezione: sectionFor(element),
        contesto: contextFor(element),
        opzioni: tag === 'select' ? Array.from(element.options)
          .map((option) => normalize(option.textContent)) : []
      };
    };
    const campi = eligible.map((element) => {
      const field = snapshot(element);
      field.radioPeers = field.tipo === 'radio' && field.name
        ? radioElements.filter((peer) => peer.type === 'radio' &&
          peer.name === field.name).map(snapshot) : [];
      return field;
    });
    const titleElement = document.querySelector('h1,h2');
    return { url: location.href,
      title: normalize(titleElement ? titleElement.textContent : document.title, 200),
      campi };
  }

  function preflightFields(items, readSessionId) {
    const session = String(readSessionId);
    const normalize = (value, limit) => String(value || '')
      .replace(/\s+/g, ' ').trim().slice(0, limit || Infinity);
    const labelFor = (element) => {
      if (element.id) {
        const explicit = Array.from(document.querySelectorAll('label'))
          .find((label) => label.htmlFor === element.id);
        if (explicit) return normalize(explicit.textContent, 160);
      }
      const aria = element.getAttribute('aria-label');
      if (aria) return normalize(aria, 160);
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const text = labelledBy.split(/\s+/)
          .map((id) => (document.getElementById(id) || {}).textContent || '').join(' ');
        if (normalize(text, 160)) return normalize(text, 160);
      }
      const wrapper = element.closest('label');
      if (wrapper) return normalize(wrapper.textContent, 160);
      return normalize(element.getAttribute('placeholder') || element.name ||
        element.id, 160);
    };
    const visible = (element) => {
      if (!element.isConnected || element.hidden || element.type === 'hidden') {
        return false;
      }
      for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
      return true;
    };
    const disabled = (element) => { try { return element.matches(':disabled'); } catch (_) { return Boolean(element.disabled); } };
    const headings = Array.from(document.querySelectorAll(
      'h1,h2,h3,h4,h5,h6,legend,[role="heading"]')).filter(visible);
    const sectionFor = (element) => {
      let section = '';
      for (const heading of headings) {
        if (heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
          section = normalize(heading.textContent, 240);
      }
      return section;
    };
    const contextFor = (element) => {
      const row = element.closest('tr,li,fieldset,[class*="rigo"],'+
        '[class*="row"],[class*="Row"]');
      return row ? normalize(row.textContent, 240) : '';
    };
    const snapshot = (element) => {
      const tag = element.tagName.toLowerCase();
      const type = tag === 'input' ? String(element.type).toLowerCase() : tag;
      const checkable = type === 'checkbox' || type === 'radio';
      const selected = tag === 'select' ? element.selectedOptions[0] : null;
      return {
        localId: Number(element.dataset.dichiareraiId),
        readSessionId: element.dataset.dichiareraiSession || '', tag, tipo: type,
        name: element.name || '', optionValue: type === 'radio' ? element.value : '',
        valore: checkable
          ? String(Boolean(element.checked))
          : (selected ? normalize(selected.textContent) : element.value || ''),
        checked: Boolean(element.checked), disabled: disabled(element),
        readOnly: Boolean(element.readOnly), required: Boolean(element.required),
        min: element.getAttribute('min') || '', max: element.getAttribute('max') || '',
        step: element.getAttribute('step') || '', pattern: element.getAttribute('pattern') || '',
        maxLength: typeof element.maxLength === 'number' ? element.maxLength : -1,
        etichetta: labelFor(element), sezione: sectionFor(element),
        contesto: contextFor(element),
        opzioni: tag === 'select' ? Array.from(element.options)
          .map((option) => normalize(option.textContent)) : []
      };
    };
    const radioCounts = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      if (item.tipo === 'radio' && item.name && item.proposedValue === 'true') {
        radioCounts.set(item.name, (radioCounts.get(item.name) || 0) + 1);
      }
    }
    const radioConflicts = new Set(Array.from(radioCounts)
      .filter(([, count]) => count > 1).map(([name]) => name));
    const results = (Array.isArray(items) ? items : []).map((item) => {
      const element = Array.from(document.querySelectorAll('[data-dichiarerai-id]'))
        .find((candidate) => candidate.dataset.dichiareraiId === String(item.localId));
      if (!element) {
        return { localId: item.localId, ok: false, code: 'FIELD_NOT_FOUND', msg: 'Campo non trovato: rileggi la pagina.' };
      }
      if (String(item.readSessionId) !== session ||
          element.dataset.dichiareraiSession !== session) {
        return { localId: item.localId, ok: false, code: 'SESSION_MISMATCH', msg: 'La sessione di lettura non è più valida.' };
      }
      if (!visible(element) || disabled(element) || element.readOnly) {
        return { localId: item.localId, ok: false, code: 'FIELD_INELIGIBLE', msg: 'Il campo non è più visibile o modificabile.' };
      }
      const tag = element.tagName.toLowerCase();
      const type = tag === 'input' ? String(element.type).toLowerCase() : tag;
      const selected = tag === 'select' ? element.selectedOptions[0] : null;
      const currentValue = type === 'checkbox' || type === 'radio'
        ? String(Boolean(element.checked))
        : (selected ? normalize(selected.textContent) : element.value || '');
      const changed = []; if (String(item.valore) !== currentValue) changed.push('valore');
      if (String(item.etichetta) !== labelFor(element)) changed.push('etichetta');
      const options = tag === 'select' ? Array.from(element.options)
        .map((option) => normalize(option.textContent)) : [];
      if (JSON.stringify(item.opzioni) !== JSON.stringify(options)) {
        changed.push('opzioni');
      }
      const currentConstraints = {
        disabled: disabled(element), readOnly: Boolean(element.readOnly),
        required: Boolean(element.required), min: element.getAttribute('min') || '',
        max: element.getAttribute('max') || '', step: element.getAttribute('step') || '',
        pattern: element.getAttribute('pattern') || '',
        maxLength: typeof element.maxLength === 'number' ? element.maxLength : -1
      };
      for (const key of Object.keys(currentConstraints)) {
        if (item[key] !== currentConstraints[key]) changed.push(key);
      }
      const currentIdentity = {
        tag, tipo: type, name: element.name || '',
        optionValue: type === 'radio' ? element.value : '',
        checked: Boolean(element.checked), sezione: sectionFor(element),
        contesto: contextFor(element)
      };
      for (const key of Object.keys(currentIdentity)) {
        if (item[key] !== currentIdentity[key]) changed.push(key);
      }
      if (type === 'radio') {
        const peers = Array.from(document.querySelectorAll('input[type="radio"]'))
          .filter((peer) => visible(peer) && peer.name === element.name)
          .map(snapshot);
        if (JSON.stringify(item.radioPeers) !== JSON.stringify(peers)) {
          changed.push('radioPeers');
        }
      }
      if (changed.length) {
        return { localId: item.localId, ok: false, code: 'FIELD_CHANGED', changed, msg: 'Il campo è cambiato: rileggi la pagina.' };
      }
      if (type === 'radio' && radioConflicts.has(item.name)) {
        return { localId: item.localId, ok: false, code: 'RADIO_GROUP_CONFLICT', msg: 'Più opzioni dello stesso gruppo radio sono state selezionate.' };
      }
      const proposed = item.proposedValue;
      const selectMatches = type === 'select' ? Array.from(element.options)
        .filter((option) => normalize(option.textContent) === normalize(proposed)) : [];
      if (selectMatches.length === 1 && disabled(selectMatches[0])) {
        return { localId: item.localId, ok: false, code: 'FIELD_INELIGIBLE', msg: 'L’opzione proposta non è modificabile.' };
      }
      let valid = typeof proposed === 'string';
      try {
        if (valid && type === 'select') {
          const option = selectMatches.length === 1 ? selectMatches[0] : null;
          const clone = element.cloneNode(true);
          const value = Object.getOwnPropertyDescriptor(
            HTMLSelectElement.prototype, 'value');
          valid = Boolean(option && !disabled(option));
          if (valid) value.set.call(clone, option.value);
          valid = valid && value.get.call(clone) === option.value && clone.checkValidity();
        } else if (valid && (type === 'checkbox' || type === 'radio')) {
          valid = type === 'radio' ? proposed === 'true'
            : proposed === 'true' || proposed === 'false';
          if (valid && type === 'checkbox') {
            const clone = element.cloneNode(true);
            clone.checked = proposed === 'true';
            valid = clone.checkValidity();
          }
        } else if (valid) {
          const clone = element.cloneNode(true);
          const prototype = type === 'textarea' ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
          const value = Object.getOwnPropertyDescriptor(prototype, 'value');
          value.set.call(clone, proposed);
          valid = value.get.call(clone) === proposed && clone.checkValidity() &&
            (item.maxLength < 0 || proposed.length <= item.maxLength);
        }
      } catch (error) { valid = false; }
      if (!valid) return { localId: item.localId, ok: false, code: 'INVALID_PROPOSED_VALUE', msg: 'Valore proposto non valido.' };
      return { localId: item.localId, ok: true };
    });
    return { ok: results.every((result) => result.ok), results };
  }

  function fillFields(items, readSessionId) {
    const session = String(readSessionId);
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const allowed = new Set(['text', 'number', 'date', 'month', 'email', 'tel',
      'checkbox', 'radio', 'select', 'textarea']);
    const disabled = (element) => { try { return element.matches(':disabled'); } catch (_) { return Boolean(element.disabled); } };
    const visible = (element) => {
      if (!element.isConnected || element.hidden) return false;
      for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
      return true;
    };
    const valueDescriptor = (element) => {
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      return Object.getOwnPropertyDescriptor(prototype, 'value');
    };
    const setNativeValue = (element, value) => {
      const descriptor = valueDescriptor(element);
      descriptor.set.call(element, value);
      return descriptor.get.call(element);
    };
    const readNativeValue = (element) => valueDescriptor(element).get.call(element);
    const notify = (element) => { element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); };
    const results = (Array.isArray(items) ? items : []).map((item) => {
      const element = Array.from(document.querySelectorAll('[data-dichiarerai-id]'))
        .find((candidate) => candidate.dataset.dichiareraiId === String(item.localId));
      if (!element) {
        return { localId: item.localId, ok: false, code: 'FIELD_NOT_FOUND', msg: 'Campo non trovato: rileggi la pagina.' };
      }
      if (element.dataset.dichiareraiSession !== session) {
        return { localId: item.localId, ok: false, code: 'SESSION_MISMATCH', msg: 'La sessione di lettura non è più valida.' };
      }
      if (!visible(element) || disabled(element) || element.readOnly) {
        return { localId: item.localId, ok: false, code: 'FIELD_INELIGIBLE', msg: 'Il campo non è più visibile o modificabile.' };
      }
      const tag = element.tagName.toLowerCase();
      const type = tag === 'input' ? String(element.type).toLowerCase() : tag;
      if (!allowed.has(type)) {
        return { localId: item.localId, ok: false, code: 'UNSUPPORTED_FIELD', msg: 'Tipo di campo non supportato.' };
      }
      try {
        const value = String(item.valore);
        if (type === 'checkbox' || type === 'radio') {
          if (value !== 'true' && value !== 'false') {
            throw new TypeError('Valore booleano non valido.');
          }
          if (type === 'radio' && value !== 'true') {
            throw new TypeError('Un radio può soltanto essere selezionato.');
          }
          const desired = value === 'true';
          if (element.checked !== desired) element.click();
          if (element.checked !== desired) throw new Error('Il campo non ha accettato il valore.');
        } else if (type === 'select') {
          const wanted = normalize(value);
          const matches = Array.from(element.options).filter((candidate) =>
            normalize(candidate.textContent) === wanted
          );
          if (matches.length !== 1) throw new Error('Opzione esatta non univoca.');
          const option = matches[0];
          if (disabled(option)) {
            const error = new Error('L’opzione proposta non è modificabile.');
            error.code = 'FIELD_INELIGIBLE';
            throw error;
          }
          setNativeValue(element, option.value);
          notify(element);
          if (readNativeValue(element) !== option.value || !element.checkValidity()) {
            throw new Error('Il campo non ha mantenuto il valore.');
          }
        } else {
          const applied = setNativeValue(element, value);
          if (applied !== value || !element.checkValidity()) {
            throw new Error('Il campo non ha accettato il valore.');
          }
          notify(element);
          if (readNativeValue(element) !== value || !element.checkValidity()) {
            throw new Error('Il campo non ha mantenuto il valore.');
          }
        }
        return { localId: item.localId, ok: true };
      } catch (error) {
        return { localId: item.localId, ok: false, code: error.code || 'RUNTIME_FAILURE',
          msg: error && error.message ? error.message : 'Aggiornamento non riuscito.' };
      }
    });
    const changed = results.filter((result) => result.ok)
      .map((result) => result.localId);
    const failed = results.filter((result) => !result.ok)
      .map((result) => result.localId);
    return { ok: failed.length === 0,
      partial: changed.length > 0 && failed.length > 0,
      changed, failed, results };
  }

  return { fillFields, preflightFields, scrapePage };
});
