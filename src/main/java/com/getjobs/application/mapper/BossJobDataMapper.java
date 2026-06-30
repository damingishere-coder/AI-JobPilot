package com.getjobs.application.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.getjobs.application.entity.BossJobDataEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface BossJobDataMapper extends BaseMapper<BossJobDataEntity> {
    @Select("""
            <script>
            SELECT *
            FROM boss_data
            WHERE profile_id = #{profileId}
            AND (
                <if test="encryptIds != null and encryptIds.size() > 0">
                    encrypt_id IN
                    <foreach collection="encryptIds" item="encryptId" open="(" separator="," close=")">
                        #{encryptId}
                    </foreach>
                </if>
                <if test="encryptIds != null and encryptIds.size() > 0 and companyNames != null and companyNames.size() > 0 and jobNames != null and jobNames.size() > 0">
                    OR
                </if>
                <if test="companyNames != null and companyNames.size() > 0 and jobNames != null and jobNames.size() > 0">
                    (
                        company_name IN
                        <foreach collection="companyNames" item="companyName" open="(" separator="," close=")">
                            #{companyName}
                        </foreach>
                        AND job_name IN
                        <foreach collection="jobNames" item="jobName" open="(" separator="," close=")">
                            #{jobName}
                        </foreach>
                    )
                </if>
            )
            ORDER BY id ASC
            </script>
            """)
    List<BossJobDataEntity> selectExistingChromeBossJobs(
            @Param("profileId") Long profileId,
            @Param("encryptIds") List<String> encryptIds,
            @Param("companyNames") List<String> companyNames,
            @Param("jobNames") List<String> jobNames
    );
}
