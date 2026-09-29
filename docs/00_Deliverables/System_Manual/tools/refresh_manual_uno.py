"""Refresh manual indexes and export DOCX/PDF via an isolated LibreOffice pipe.

Run with LibreOffice's bundled Python (which provides uno), after starting a
headless instance with --accept=pipe,name=focusflow_ch11;urp;... .
"""
import argparse
from pathlib import Path
import time
import uno


def prop(name, value):
    p = uno.createUnoStruct('com.sun.star.beans.PropertyValue')
    p.Name, p.Value = name, value
    return p


def main():
    p = argparse.ArgumentParser()
    p.add_argument('source', type=Path)
    p.add_argument('output', type=Path, help='Output path without extension')
    p.add_argument('--pipe', default='focusflow_ch11')
    args = p.parse_args()
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
    for attempt in range(30):
        try:
            ctx = resolver.resolve('uno:pipe,name=' + args.pipe + ';urp;StarOffice.ComponentContext')
            break
        except Exception:
            if attempt == 29:
                raise
            time.sleep(1)
    desktop = ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', ctx)
    doc = desktop.loadComponentFromURL(args.source.resolve().as_uri(), '_blank', 0,
        (prop('Hidden', True), prop('ReadOnly', False), prop('UpdateDocMode', 3), prop('MacroExecutionMode', 4)))
    if doc is None:
        raise RuntimeError('Document could not be opened')
    try:
        indexes = doc.getDocumentIndexes()
        print('INDEXES', indexes.Count, flush=True)
        # School manual contents and illustration/table indexes use 14pt.
        styles = doc.StyleFamilies.getByName('ParagraphStyles')
        for name in styles.ElementNames:
            if name.startswith(('Contents ', 'Illustration Index ', 'Table Index ')):
                style = styles.getByName(name)
                style.CharHeight = 14
                style.CharHeightAsian = 14
        for _ in range(2):
            doc.refresh()
            for i in range(indexes.Count):
                indexes.getByIndex(i).update()
        print('INDEXES_UPDATED', flush=True)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        doc.storeAsURL(args.output.with_suffix('.docx').resolve().as_uri(),
                       (prop('FilterName', 'Office Open XML Text'), prop('Overwrite', True)))
        print('DOCX_SAVED', flush=True)
        doc.storeToURL(args.output.with_suffix('.pdf').resolve().as_uri(),
                       (prop('FilterName', 'writer_pdf_Export'), prop('Overwrite', True),
                        prop('FilterData', (prop('ExportBookmarks', True),))))
        print('PDF_SAVED', flush=True)
    finally:
        doc.setModified(False)
        doc.close(True)
        desktop.terminate()


if __name__ == '__main__':
    main()
