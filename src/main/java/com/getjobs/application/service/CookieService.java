package com.getjobs.application.service;

import com.getjobs.application.entity.CookieEntity;
import com.getjobs.application.mapper.CookieMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 已停用的 Cookie 存储兼容入口；禁止读取、修改或删除历史记录。
 */
@Service
@RequiredArgsConstructor
public class CookieService {

    private final CookieMapper cookieMapper;

    /**
     * 根据平台获取Cookie
     * @param platform 平台名称（boss/zhilian/job51/liepin）
     * @return Cookie实体
     */
    public CookieEntity getCookieByPlatform(String platform) {
        throw new UnsupportedOperationException("招聘会话仅保留在浏览器；后端 Cookie 存储已停用，历史记录保留。");
    }

    /**
     * 保存或更新Cookie
     * @param platform 平台名称
     * @param cookieValue Cookie值
     * @param remark 备注
     * @return 是否成功
     */
    public boolean saveOrUpdateCookie(String platform, String cookieValue, String remark) {
        throw new UnsupportedOperationException("招聘会话仅保留在浏览器；后端 Cookie 存储已停用，历史记录保留。");
    }

    /**
     * 清空指定平台的所有Cookie值（处理重复记录场景）
     * @param platform 平台名称
     * @param remark 备注
     * @return 影响行数是否大于0
     */
    public boolean clearCookieByPlatform(String platform, String remark) {
        throw new UnsupportedOperationException("招聘会话仅保留在浏览器；后端 Cookie 存储已停用，历史记录保留。");
    }

    /**
     * 删除指定平台的Cookie
     * @param platform 平台名称
     * @return 是否成功
     */
    public boolean deleteCookie(String platform) {
        throw new UnsupportedOperationException("招聘会话仅保留在浏览器；后端 Cookie 存储已停用，历史记录保留。");
    }

    /**
     * 获取所有Cookie
     * @return Cookie列表
     */
    public List<CookieEntity> getAllCookies() {
        throw new UnsupportedOperationException("招聘会话仅保留在浏览器；后端 Cookie 存储已停用，历史记录保留。");
    }
}
