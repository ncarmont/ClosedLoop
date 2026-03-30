// Calculator logic
// NOTE: This file has 3 bugs for the ClosedLoop demo:
//   Bug 1 (visual)  — style.css: calculator width too narrow, display clips long numbers
//   Bug 2 (logic)   — subtraction operator mistakenly adds instead of subtracts
//   Bug 3 (runtime) — clearAll references a variable that doesn't exist → console error

let currentInput = '';
let expression = '';
let lastResult = null;

function updateDisplay() {
  document.getElementById('expression').textContent = expression;
  document.getElementById('result').textContent = currentInput || lastResult || '0';
}

function inputNum(n) {
  if (n === '.' && currentInput.includes('.')) return;
  currentInput += n;
  updateDisplay();
}

function inputOp(op) {
  if (currentInput === '' && expression === '') return;
  if (currentInput !== '') {
    expression += currentInput + ' ' + op + ' ';
    currentInput = '';
  } else {
    // replace last operator
    expression = expression.trimEnd().slice(0, -1) + op + ' ';
  }
  updateDisplay();
}

function calculate() {
  if (currentInput !== '') {
    expression += currentInput;
  }
  if (expression === '') return;

  try {
    // BUG 2: subtraction is broken — minus signs are replaced with plus before eval
    const broken = expression.replace(/-/g, '+');
    const result = Function('"use strict"; return (' + broken + ')')();
    const resultStr = parseFloat(result.toFixed(10)).toString();

    addHistory(expression + ' = ' + resultStr);
    lastResult = resultStr;
    expression = '';
    currentInput = '';
    updateDisplay();
  } catch (e) {
    document.getElementById('result').textContent = 'Error';
    expression = '';
    currentInput = '';
  }
}

function clearAll() {
  // BUG 3: references undeclared variable `historyLog` — throws ReferenceError
  historyLog.push({ cleared: true, at: Date.now() });

  currentInput = '';
  expression = '';
  lastResult = null;
  updateDisplay();
}

function addHistory(entry) {
  const list = document.getElementById('history-list');
  const li = document.createElement('li');
  li.textContent = entry;
  list.prepend(li);
  // Keep max 20 items
  while (list.children.length > 20) {
    list.removeChild(list.lastChild);
  }
}
