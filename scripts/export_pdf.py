#!/usr/bin/env python3
"""
Timetable PDF Export Script
Generates PDF timetables for classes and teachers
"""

import json
import sys
import os
from datetime import datetime

# ReportLab imports
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import inch, cm
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# Register fonts
try:
    pdfmetrics.registerFont(TTFont('Times New Roman', '/usr/share/fonts/truetype/english/Times-New-Roman.ttf'))
except:
    pass

def create_class_timetable_pdf(data, output_path):
    """Generate PDF with class timetables"""
    doc = SimpleDocTemplate(
        output_path,
        pagesize=landscape(A4),
        title="Class Timetables",
        author="Z.ai",
        creator="Z.ai",
        subject="Modern Indian School Timetable 2025-26"
    )
    
    styles = getSampleStyleSheet()
    
    # Custom styles
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Title'],
        fontName='Times New Roman',
        fontSize=24,
        alignment=TA_CENTER,
        spaceAfter=20
    )
    
    subtitle_style = ParagraphStyle(
        'CustomSubtitle',
        parent=styles['Normal'],
        fontName='Times New Roman',
        fontSize=14,
        alignment=TA_CENTER,
        spaceAfter=10
    )
    
    header_style = ParagraphStyle(
        'TableHeader',
        fontName='Times New Roman',
        fontSize=9,
        textColor=colors.white,
        alignment=TA_CENTER
    )
    
    cell_style = ParagraphStyle(
        'TableCell',
        fontName='Times New Roman',
        fontSize=8,
        alignment=TA_CENTER
    )
    
    story = []
    
    # Cover page
    story.append(Spacer(1, 2*inch))
    story.append(Paragraph("Modern Indian School", title_style))
    story.append(Paragraph("Class Timetables 2025-26", subtitle_style))
    story.append(Spacer(1, 0.5*inch))
    story.append(Paragraph(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}", subtitle_style))
    story.append(PageBreak())
    
    # Create timetable for each section
    sections = data.get('sections', [])
    days = data.get('days', ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])
    periods = data.get('periods', [])
    timetable = data.get('timetable', [])
    
    # Group timetable by section
    section_timetables = {}
    for slot in timetable:
        section_name = slot.get('section', 'Unknown')
        if section_name not in section_timetables:
            section_timetables[section_name] = {}
        key = f"{slot.get('day', '')}-{slot.get('period', 0)}"
        section_timetables[section_name][key] = slot
    
    for section in sections:
        section_name = section.get('name', 'Unknown')
        
        # Section header
        story.append(Paragraph(f"<b>{section_name}</b>", subtitle_style))
        if section.get('classTeacher'):
            story.append(Paragraph(f"Class Teacher: {section['classTeacher']}", styles['Normal']))
        story.append(Spacer(1, 10))
        
        # Get timetable for this section
        section_slots = section_timetables.get(section_name, {})
        
        # Build table data
        table_data = []
        
        # Header row
        header_row = [Paragraph('<b>Period</b>', header_style)]
        for day in days:
            header_row.append(Paragraph(f'<b>{day}</b>', header_style))
        table_data.append(header_row)
        
        # Period rows
        for period_info in periods:
            period_num = period_info.get('period', 0)
            time_str = f"{period_info.get('start', '')}-{period_info.get('end', '')}"
            
            row = [Paragraph(f'<b>P{period_num}</b><br/><font size="6">{time_str}</font>', cell_style)]
            
            for day in days:
                key = f"{day}-{period_num}"
                slot = section_slots.get(key, {})
                
                if slot:
                    subject = slot.get('subject', '')
                    teacher = slot.get('teacherAbbr', '')
                    cell_text = f"{subject}<br/><font size='6'>{teacher}</font>"
                    row.append(Paragraph(cell_text, cell_style))
                else:
                    row.append(Paragraph('-', cell_style))
            
            table_data.append(row)
        
        # Create table
        col_widths = [1.2*cm] + [3.5*cm] * len(days)
        table = Table(table_data, colWidths=col_widths)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1F4E79')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('FONTNAME', (0, 0), (-1, -1), 'Times New Roman'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('FONTSIZE', (0, 1), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F5F5F5')]),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        
        story.append(table)
        story.append(PageBreak())
    
    doc.build(story)
    print(f"PDF generated: {output_path}")


def create_teacher_timetable_pdf(data, output_path):
    """Generate PDF with teacher timetables"""
    doc = SimpleDocTemplate(
        output_path,
        pagesize=landscape(A4),
        title="Teacher Timetables",
        author="Z.ai",
        creator="Z.ai",
        subject="Modern Indian School Teacher Schedule 2025-26"
    )
    
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Title'],
        fontName='Times New Roman',
        fontSize=24,
        alignment=TA_CENTER,
        spaceAfter=20
    )
    
    subtitle_style = ParagraphStyle(
        'CustomSubtitle',
        parent=styles['Normal'],
        fontName='Times New Roman',
        fontSize=14,
        alignment=TA_CENTER,
        spaceAfter=10
    )
    
    header_style = ParagraphStyle(
        'TableHeader',
        fontName='Times New Roman',
        fontSize=9,
        textColor=colors.white,
        alignment=TA_CENTER
    )
    
    cell_style = ParagraphStyle(
        'TableCell',
        fontName='Times New Roman',
        fontSize=8,
        alignment=TA_CENTER
    )
    
    story = []
    
    # Cover page
    story.append(Spacer(1, 2*inch))
    story.append(Paragraph("Modern Indian School", title_style))
    story.append(Paragraph("Teacher Timetables 2025-26", subtitle_style))
    story.append(Spacer(1, 0.5*inch))
    story.append(Paragraph(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}", subtitle_style))
    story.append(PageBreak())
    
    days = data.get('days', ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])
    periods = data.get('periods', [])
    timetable = data.get('timetable', [])
    teachers = data.get('teachers', [])
    
    # Group timetable by teacher
    teacher_timetables = {}
    for slot in timetable:
        teacher_name = slot.get('teacher', 'Unknown')
        if teacher_name not in teacher_timetables:
            teacher_timetables[teacher_name] = {}
        key = f"{slot.get('day', '')}-{slot.get('period', 0)}"
        teacher_timetables[teacher_name][key] = slot
    
    for teacher in teachers:
        teacher_name = teacher.get('name', 'Unknown')
        dept = teacher.get('department', '')
        
        # Teacher header
        story.append(Paragraph(f"<b>{teacher_name}</b>", subtitle_style))
        story.append(Paragraph(f"Department: {dept} | Target: {teacher.get('targetWorkload', 0)} | Current: {teacher.get('currentWorkload', 0)}", styles['Normal']))
        story.append(Spacer(1, 10))
        
        # Get timetable for this teacher
        teacher_slots = teacher_timetables.get(teacher_name, {})
        
        # Build table data
        table_data = []
        
        # Header row
        header_row = [Paragraph('<b>Period</b>', header_style)]
        for day in days:
            header_row.append(Paragraph(f'<b>{day}</b>', header_style))
        table_data.append(header_row)
        
        # Period rows
        for period_info in periods:
            period_num = period_info.get('period', 0)
            time_str = f"{period_info.get('start', '')}-{period_info.get('end', '')}"
            
            row = [Paragraph(f'<b>P{period_num}</b><br/><font size="6">{time_str}</font>', cell_style)]
            
            for day in days:
                key = f"{day}-{period_num}"
                slot = teacher_slots.get(key, {})
                
                if slot:
                    section = slot.get('section', '')
                    subject = slot.get('subject', '')
                    cell_text = f"{section}<br/><font size='6'>{subject}</font>"
                    row.append(Paragraph(cell_text, cell_style))
                else:
                    row.append(Paragraph('-', cell_style))
            
            table_data.append(row)
        
        # Create table
        col_widths = [1.2*cm] + [3.5*cm] * len(days)
        table = Table(table_data, colWidths=col_widths)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1F4E79')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('FONTNAME', (0, 0), (-1, -1), 'Times New Roman'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('FONTSIZE', (0, 1), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F5F5F5')]),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        
        story.append(table)
        story.append(PageBreak())
    
    doc.build(story)
    print(f"Teacher PDF generated: {output_path}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python export_pdf.py <data_file.json> <output_file.pdf> [type]")
        print("  type: 'class' or 'teacher' (default: 'class')")
        sys.exit(1)
    
    data_file = sys.argv[1]
    output_file = sys.argv[2]
    export_type = sys.argv[3] if len(sys.argv) > 3 else 'class'
    
    with open(data_file, 'r') as f:
        data = json.load(f)
    
    if export_type == 'teacher':
        create_teacher_timetable_pdf(data, output_file)
    else:
        create_class_timetable_pdf(data, output_file)
