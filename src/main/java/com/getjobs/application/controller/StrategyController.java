package com.getjobs.application.controller;

import com.getjobs.application.service.*;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/strategy")
@RequiredArgsConstructor
public class StrategyController {
    private final StrategyService strategy;
    private final LocalActionTokenService tokens;
    @GetMapping("/snapshots") public Object list(){return strategy.list();}
    @GetMapping("/snapshots/{id}") public Object detail(@PathVariable long id){return strategy.detail(id);}
    @PostMapping("/snapshots") public ResponseEntity<?> create(@RequestBody StrategyService.Create request,@RequestHeader(value=LocalActionTokenService.HEADER_NAME,required=false) String token){
        if(!tokens.isValid(token)) return ResponseEntity.status(401).body(Map.of("success",false,"message","请刷新页面后重试"));
        return ResponseEntity.ok(strategy.create(request));
    }
    @PostMapping("/snapshots/{id}/decision") public ResponseEntity<?> decide(@PathVariable long id,@RequestBody StrategyService.Decision request,@RequestHeader(value=LocalActionTokenService.HEADER_NAME,required=false) String token){
        if(!tokens.isValid(token)) return ResponseEntity.status(401).body(Map.of("success",false,"message","请刷新页面后重试"));
        return ResponseEntity.ok(strategy.decide(id,request));
    }
    @ExceptionHandler({IllegalArgumentException.class,IllegalStateException.class}) public ResponseEntity<?> invalid(RuntimeException error){return ResponseEntity.status(409).body(Map.of("success",false,"message",error.getMessage()));}
}
