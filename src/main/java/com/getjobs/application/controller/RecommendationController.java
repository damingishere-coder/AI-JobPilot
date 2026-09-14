package com.getjobs.application.controller;

import com.getjobs.application.service.*;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/strategy/ranking")
@RequiredArgsConstructor
public class RecommendationController {
    private final RecommendationService ranking;
    private final LocalActionTokenService tokens;
    @GetMapping("/settings") public Object settings(){return ranking.settings();}
    @GetMapping public Object list(){return ranking.recommendations();}
    @PostMapping("/preview") public Object preview(@RequestBody RecommendationService.Preview request){return ranking.preview(request);}
    @PostMapping("/settings") public ResponseEntity<?> save(@RequestBody RecommendationService.Save request,@RequestHeader(value=LocalActionTokenService.HEADER_NAME,required=false) String token){
        if(!tokens.isValid(token)) return ResponseEntity.status(401).body(Map.of("success",false,"message","请刷新页面后重试"));
        return ResponseEntity.ok(ranking.save(request));
    }
    @ExceptionHandler({IllegalArgumentException.class,IllegalStateException.class}) public ResponseEntity<?> invalid(RuntimeException error){return ResponseEntity.status(409).body(Map.of("success",false,"message",error.getMessage()));}
}
