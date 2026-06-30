package com.getjobs.application.controller;

import com.getjobs.application.entity.ProfileEntity;
import com.getjobs.application.service.ProfileService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/api/profiles")
@RequiredArgsConstructor
public class ProfileController {
    private final ProfileService profileService;

    @GetMapping
    public Map<String, Object> listProfiles() {
        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("data", profileService.listProfiles());
        response.put("current", profileService.getCurrentProfile());
        response.put("hasProfile", profileService.hasProfiles());
        return response;
    }

    @GetMapping("/current")
    public Map<String, Object> currentProfile() {
        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("data", profileService.getCurrentProfile());
        response.put("hasProfile", profileService.hasProfiles());
        return response;
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> createProfile(@RequestBody Map<String, String> body) {
        return ok("档案已创建", profileService.createProfile(body == null ? null : body.get("name")));
    }

    @PutMapping("/{id}")
    public ResponseEntity<Map<String, Object>> renameProfile(
            @PathVariable Long id,
            @RequestBody Map<String, String> body
    ) {
        return ok("档案已更新", profileService.renameProfile(id, body == null ? null : body.get("name")));
    }

    @PostMapping("/{id}/activate")
    public ResponseEntity<Map<String, Object>> activateProfile(@PathVariable Long id) {
        return ok("档案已切换", profileService.activateProfile(id));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, Object>> deleteProfile(
            @PathVariable Long id,
            @RequestParam(defaultValue = "false") boolean force
    ) {
        ProfileService.DeleteProfileResult result = profileService.deleteProfile(id, force);
        Map<String, Object> response = new HashMap<>();
        response.put("success", result.success());
        response.put("message", result.message());
        response.put("impactCounts", result.impactCounts());
        response.put("totalRelatedCount", result.totalRelatedCount());
        response.put("forceRequired", result.forceRequired());
        response.put("current", result.current());
        return ResponseEntity.ok(response);
    }

    private ResponseEntity<Map<String, Object>> ok(String message, ProfileEntity data) {
        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("data", data);
        response.put("message", message);
        return ResponseEntity.ok(response);
    }
}
