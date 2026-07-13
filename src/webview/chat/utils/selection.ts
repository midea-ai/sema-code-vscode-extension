/**
 * 判断当前是否存在非空文本选区。
 * 拖拽选中文本后松开鼠标也会触发 click（click 落在按下/松开位置的最近公共祖先上），
 * 若此时执行"打开文件/diff"会把焦点抢到编辑器，用户随后的 Cmd+C 变成编辑器的
 * "空选区复制当前行"，导致复制选中文本失败。点击处理开头用本函数守卫。
 */
export function hasTextSelection(): boolean {
    const selection = window.getSelection();
    return !!selection && selection.toString().length > 0;
}
