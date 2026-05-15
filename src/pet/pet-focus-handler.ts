import * as vscode from 'vscode';

export function handlePetFocus(): void {
  void vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  void vscode.commands.executeCommand('sema-vscode-view.focus');
}
