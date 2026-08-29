import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  fileKey,
  formatFileSize,
  isTerminalStatus,
  mergeSelectedFiles,
  titleFromFilename,
  validateVideoFile,
} from '../src/pages/teacherUploadUtils.js';

function file(name, size = 1024, lastModified = 1) {
  return { name, size, lastModified };
}

describe('TeacherUpload 多檔選擇工具', () => {
  it('以 name、size、lastModified 產生穩定 key', () => {
    assert.equal(fileKey(file('a.mp4', 20, 30)), 'a.mp4:20:30');
  });

  it('同一檔案不重複加入', () => {
    const selected = file('a.mp4', 20, 30);
    assert.equal(mergeSelectedFiles([selected], [selected]).files.length, 1);
  });

  it('同名但大小不同視為不同檔案', () => {
    assert.equal(mergeSelectedFiles([file('a.mp4', 20)], [file('a.mp4', 21)]).files.length, 2);
  });

  it('接受 MP4、MOV、MKV 且不分大小寫', () => {
    ['a.mp4', 'a.MOV', 'a.mkv'].forEach((name) => assert.equal(validateVideoFile(file(name)), ''));
  });

  it('拒絕不支援格式', () => {
    assert.match(validateVideoFile(file('a.txt')), /MP4/);
  });

  it('拒絕超過大小限制', () => {
    assert.match(validateVideoFile(file('large.mp4', 101), 100), /超過/);
  });

  it('格式化檔案大小', () => {
    assert.equal(formatFileSize(5 * 1024 * 1024), '5.0 MB');
  });

  it('移除最後一個副檔名作為預設標題', () => {
    assert.equal(titleFromFilename('第三講.迴圈.mp4'), '第三講.迴圈');
  });

  it('辨識 terminal processing status', () => {
    assert.equal(isTerminalStatus('completed'), true);
    assert.equal(isTerminalStatus('duplicate'), true);
    assert.equal(isTerminalStatus('processing'), false);
  });
});
