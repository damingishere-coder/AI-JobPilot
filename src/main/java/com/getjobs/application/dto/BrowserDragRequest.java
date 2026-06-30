package com.getjobs.application.dto;

import lombok.Data;

@Data
public class BrowserDragRequest {
    private Double fromX;
    private Double fromY;
    private Double toX;
    private Double toY;
}
